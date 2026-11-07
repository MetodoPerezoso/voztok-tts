const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { TikTokLiveConnection } = require('tiktok-live-connector');
const gTTS = require('gtts');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));

const dirTemp = path.join(__dirname, 'public', 'temp');
if (!fs.existsSync(dirTemp)) {
    fs.mkdirSync(dirTemp, { recursive: true });
}

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

let licenciasValidas = {};
const sesionesActivasPorLicencia = {};

let rankingLikes = {};

const mapaEmojisTikTok = {
    'laughcry': 'jaja',
    'joy': 'jaja',
    'smile': 'sonrisa',
    'heart': 'corazón',
    'love': 'me encanta',
    'rose': 'rosa',
    'fire': 'fuego',
    'clap': 'aplausos',
    'cry': 'carita llorando',
    'wink': 'guiño',
    'surprised': 'sorpresa',
    'thinking': 'pensativo',
    'thumbsup': 'me gusta',
    'cool': 'genial'
};

function cargarLicencias() {
    try {
        const filePath = path.join(__dirname, 'licenses.json');
        if (!fs.existsSync(filePath)) {
            const defaultLicenses = { 
                "VOZ-PRO-2026": { "activa": true, "expiracion": "2026-12-31", "nota": "Admin Principal" },
                "RODRI-ADMIN-2026": { "activa": true, "expiracion": null, "nota": "Propietario" }
            };
            fs.writeFileSync(filePath, JSON.stringify(defaultLicenses, null, 2));
            licenciasValidas = defaultLicenses;
        } else {
            const data = fs.readFileSync(filePath, 'utf8');
            licenciasValidas = JSON.parse(data);
        }
    } catch (e) {
        console.error("❌ Error leyendo licenses.json:", e);
    }
}

cargarLicencias();

app.get('/widget-likes', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'widget-likes.html'));
});

app.post('/api/reset-likes', (req, res) => {
    rankingLikes = {};
    io.emit('actualizar-ranking-likes', []);
    res.json({ success: true });
});

// ==========================================
// PANEL DE ADMINISTRACIÓN PRIVADO (/admin)
// ==========================================
app.get('/admin', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Voztok - Admin de Licencias</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; padding: 15px; max-width: 950px; margin: 0 auto; }
                h2 { color: #38bdf8; text-align: center; }
                .card { background: #1e293b; padding: 15px; border-radius: 12px; border: 1px solid #334155; margin-bottom: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
                input, button, select { padding: 10px; font-size: 14px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: white; width: 100%; box-sizing: border-box; margin-top: 6px; }
                button { background: #fe2c55; font-weight: bold; cursor: pointer; border: none; transition: background 0.2s; }
                button:hover { background: #e0244b; }
                .btn-green { background: #22c55e; }
                .btn-green:hover { background: #16a34a; }
                
                /* Contenedor con scroll para muchas licencias */
                .table-container { max-height: 400px; overflow-y: auto; margin-top: 10px; border: 1px solid #334155; border-radius: 6px; }
                table { width: 100%; border-collapse: collapse; font-size: 13px; }
                th, td { padding: 8px; border-bottom: 1px solid #334155; text-align: left; background: #1e293b; }
                th { color: #38bdf8; position: sticky; top: 0; z-index: 10; }
                
                .badge-activo { color: #4ade80; font-weight: bold; }
                .badge-inactivo { color: #ef4444; font-weight: bold; }
                .input-nota, .input-fecha { background: #0f172a; border: 1px solid #475569; color: white; padding: 5px; border-radius: 4px; width: 100%; font-size: 12px; }
                
                .password-wrapper { position: relative; display: flex; align-items: center; }
                .toggle-password { position: absolute; right: 10px; background: none; border: none; cursor: pointer; font-size: 18px; width: auto; color: #94a3b8; }
            </style>
        </head>
        <body>
            <h2>🛠️ Panel Admin - Voztok</h2>
            
            <div class="card">
                <h3>🔐 Autenticación</h3>
                <div class="password-wrapper">
                    <input type="password" id="adminPass" placeholder="Ingresa tu contraseña maestra">
                    <button type="button" class="toggle-password" onclick="togglePasswordVisibility()">👁️</button>
                </div>
            </div>

            <div class="card">
                <h3>⚡ Generar Nuevas Licencias (Formato VZ-XXX-XXX)</h3>
                <label>Cantidad:</label>
                <input type="number" id="cantidadGen" value="5" min="1" max="50">
                <button class="btn-green" onclick="generarLoteAdmin()">Crear y Guardar en Servidor</button>
            </div>

            <div class="card">
                <h3>📋 Licencias Registradas en el Sistema</h3>
                <button onclick="cargarLicencias()">🔄 Cargar / Actualizar Lista</button>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Licencia</th>
                                <th>Estado</th>
                                <th>Vencimiento</th>
                                <th>Nota / Cliente</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="tablaLicencias">
                            <tr><td colspan="5" style="text-align: center; color: #64748b;">Ingrese contraseña y cargue la lista...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <script>
                function togglePasswordVisibility() {
                    const inputKey = document.getElementById('adminPass');
                    const btnToggle = document.querySelector('.toggle-password');
                    if (inputKey.type === 'password') {
                        inputKey.type = 'text';
                        btnToggle.innerText = '🙈';
                    } else {
                        inputKey.type = 'password';
                        btnToggle.innerText = '👁️';
                    }
                }

                async function cargarLicencias() {
                    const pass = document.getElementById('adminPass').value;
                    const res = await fetch('/api/admin/licencias', {
                        headers: { 'x-admin-pass': pass }
                    });
                    if(res.status === 403) {
                        alert("Contraseña de administrador incorrecta");
                        return;
                    }
                    const data = await res.json();
                    const tbody = document.getElementById('tablaLicencias');
                    tbody.innerHTML = '';

                    for (const [key, info] of Object.entries(data)) {
                        const notaActual = info.nota || '';
                        const fechaActual = info.expiracion || '';
                        const activaChecked = info.activa ? 'checked' : '';
                        
                        tbody.innerHTML += \`
                            <tr>
                                <td><code style="color: #38bdf8; font-size: 13px; font-weight: bold;">\${key}</code></td>
                                <td>
                                    <label style="cursor:pointer; font-size: 12px;">
                                        <input type="checkbox" \${activaChecked} onchange="toggleActiva('\${key}', this.checked)" style="width:auto; cursor:pointer;"> 
                                        \${info.activa ? '<span class="badge-activo">Activa</span>' : '<span class="badge-inactivo">Inactiva</span>'}
                                    </label>
                                </td>
                                <td>
                                    <input type="date" class="input-fecha" value="\${fechaActual}" onchange="guardarFecha('\${key}', this.value)" title="Modificar fecha de vencimiento">
                                </td>
                                <td>
                                    <input type="text" class="input-nota" value="\${notaActual}" placeholder="Ej: @usuario / mail" onchange="guardarNota('\${key}', this.value)">
                                </td>
                                <td>
                                    <button onclick="extenderLicencia('\${key}')" style="padding: 5px; font-size: 11px; background: #0284c7; width: auto;" title="Sumar 30 días">+30 Días</button>
                                </td>
                            </tr>
                        \`;
                    }
                }

                async function generarLoteAdmin() {
                    const pass = document.getElementById('adminPass').value;
                    const cantidad = document.getElementById('cantidadGen').value;
                    const res = await fetch('/api/admin/generar', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-pass': pass },
                        body: JSON.stringify({ cantidad: parseInt(cantidad) })
                    });
                    if(res.status === 403) { alert("Contraseña incorrecta"); return; }
                    alert("¡Lote generado y guardado con éxito!");
                    cargarLicencias();
                }

                async function extenderLicencia(key) {
                    const pass = document.getElementById('adminPass').value;
                    const res = await fetch('/api/admin/extender', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-pass': pass },
                        body: JSON.stringify({ key })
                    });
                    if(res.status === 403) { alert("Contraseña incorrecta"); return; }
                    cargarLicencias();
                }

                async function toggleActiva(key, activa) {
                    const pass = document.getElementById('adminPass').value;
                    await fetch('/api/admin/actualizar-estado', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-pass': pass },
                        body: JSON.stringify({ key, activa })
                    });
                    cargarLicencias();
                }

                async function guardarNota(key, nota) {
                    const pass = document.getElementById('adminPass').value;
                    await fetch('/api/admin/actualizar-nota', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-pass': pass },
                        body: JSON.stringify({ key, nota })
                    });
                }

                async function guardarFecha(key, expiracion) {
                    const pass = document.getElementById('adminPass').value;
                    await fetch('/api/admin/actualizar-fecha', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-pass': pass },
                        body: JSON.stringify({ key, expiracion })
                    });
                }
            </script>
        </body>
        </html>
    `);
});

const verificarAdmin = (req, res, next) => {
    const pass = req.headers['x-admin-pass'] || req.body.pass;
    const ADMIN_SECRET = process.env.ADMIN_SECRET || "metodoperezoso2026"; 
    if (pass === ADMIN_SECRET) {
        next();
    } else {
        res.status(403).json({ error: "No autorizado" });
    }
};

app.get('/api/admin/licencias', verificarAdmin, (req, res) => {
    cargarLicencias();
    res.json(licenciasValidas);
});

app.post('/api/admin/generar', express.json(), verificarAdmin, (req, res) => {
    const cantidad = req.body.cantidad || 5;
    cargarLicencias();
    const conjuntoExistentes = new Set(Object.keys(licenciasValidas));

    const generarBloque = (longitud = 3) => {
        const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let resStr = '';
        for (let i = 0; i < longitud; i++) {
            resStr += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
        }
        return resStr;
    };

    const fechaFutura = new Date();
    fechaFutura.setDate(fechaFutura.getDate() + 90);
    const fechaStr = fechaFutura.toISOString().split('T')[0];

    let creadas = 0;
    while (creadas < cantidad) {
        const nuevaClave = `VZ-${generarBloque(3)}-${generarBloque(3)}`;
        if (!conjuntoExistentes.has(nuevaClave)) {
            conjuntoExistentes.add(nuevaClave);
            licenciasValidas[nuevaClave] = { 
                "activa": true, 
                "expiracion": fechaStr,
                "nota": "Disponible (Sin asignar)" 
            };
            creadas++;
        }
    }

    const filePath = path.join(__dirname, 'licenses.json');
    fs.writeFileSync(filePath, JSON.stringify(licenciasValidas, null, 4), 'utf8');
    res.json({ success: true, total: Object.keys(licenciasValidas).length });
});

app.post('/api/admin/extender', express.json(), verificarAdmin, (req, res) => {
    const { key } = req.body;
    cargarLicencias();

    if (licenciasValidas[key]) {
        let baseDate = new Date();
        if (licenciasValidas[key].expiracion) {
            let currentExp = new Date(licenciasValidas[key].expiracion + 'T00:00:00');
            if (currentExp > baseDate) baseDate = currentExp;
        }
        baseDate.setDate(baseDate.getDate() + 30);
        licenciasValidas[key].expiracion = baseDate.toISOString().split('T')[0];
        licenciasValidas[key].activa = true;

        const filePath = path.join(__dirname, 'licenses.json');
        fs.writeFileSync(filePath, JSON.stringify(licenciasValidas, null, 4), 'utf8');
        return res.json({ success: true, nuevaExpiracion: licenciasValidas[key].expiracion });
    }
    res.status(404).json({ error: "Licencia no encontrada" });
});

app.post('/api/admin/actualizar-estado', express.json(), verificarAdmin, (req, res) => {
    const { key, activa } = req.body;
    cargarLicencias();
    if (licenciasValidas[key]) {
        licenciasValidas[key].activa = activa;
        const filePath = path.join(__dirname, 'licenses.json');
        fs.writeFileSync(filePath, JSON.stringify(licenciasValidas, null, 4), 'utf8');
        return res.json({ success: true });
    }
    res.status(404).json({ error: "No encontrada" });
});

app.post('/api/admin/actualizar-nota', express.json(), verificarAdmin, (req, res) => {
    const { key, nota } = req.body;
    cargarLicencias();
    if (licenciasValidas[key]) {
        licenciasValidas[key].nota = nota;
        const filePath = path.join(__dirname, 'licenses.json');
        fs.writeFileSync(filePath, JSON.stringify(licenciasValidas, null, 4), 'utf8');
        return res.json({ success: true });
    }
    res.status(404).json({ error: "No encontrada" });
});

app.post('/api/admin/actualizar-fecha', express.json(), verificarAdmin, (req, res) => {
    const { key, expiracion } = req.body;
    cargarLicencias();
    if (licenciasValidas[key]) {
        licenciasValidas[key].expiracion = expiracion || null;
        const filePath = path.join(__dirname, 'licenses.json');
        fs.writeFileSync(filePath, JSON.stringify(licenciasValidas, null, 4), 'utf8');
        return res.json({ success: true });
    }
    res.status(404).json({ error: "No encontrada" });
});
// ==========================================

function limpiarTexto(texto, permitirEmojis = false) {
    if (!texto) return '';

    if (permitirEmojis) {
        let textoProcesado = texto.replace(/\[([a-zA-Z0-9_]+)\]/g, (match, tag) => {
            const tagMin = tag.toLowerCase();
            return mapaEmojisTikTok[tagMin] ? ` ${mapaEmojisTikTok[tagMin]} ` : '';
        });
        return textoProcesado.trim();
    }

    let textoSinTags = texto.replace(/\[[a-zA-Z0-9_]+\]/g, '');
    return textoSinTags.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
}

function contienePalabraProhibida(texto, listaProhibidas) {
    if (!listaProhibidas || listaProhibidas.length === 0 || !texto) return false;
    const textoMin = texto.toLowerCase();
    return listaProhibidas.some(palabra => {
        const pLimpia = palabra.trim().toLowerCase();
        return pLimpia.length > 0 && textoMin.includes(pLimpia);
    });
}

function guardarAudioBase64(base64Data) {
    if (!base64Data) return null;
    try {
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return null;

        const buffer = Buffer.from(matches[2], 'base64');
        const nombreArchivo = `custom_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
        const rutaArchivo = path.join(dirTemp, nombreArchivo);

        fs.writeFileSync(rutaArchivo, buffer);
        return `/temp/${nombreArchivo}`;
    } catch (e) {
        console.error("❌ Error al guardar archivo de audio personalizado:", e);
        return null;
    }
}

io.on('connection', (socket) => {
    let tiktokLiveConnection = null;
    let configuracionCliente = null;
    let claveLicenciaAsociada = null;

    socket.on('validar-licencia', (data) => {
        const key = data.key ? data.key.trim() : '';
        cargarLicencias();

        const licencia = licenciasValidas[key];

        if (licencia && licencia.activa) {
            let expiracionTexto = "Licencia Ilimitada (Vitalicia)";
            if (licencia.expiracion) {
                const fechaActual = new Date();
                const fechaExpiracion = new Date(licencia.expiracion + 'T23:59:59');

                if (fechaActual > fechaExpiracion) {
                    socket.emit('respuesta-licencia', { valida: false, mensaje: "Tu clave de acceso ha expirado." });
                    return;
                }
                expiracionTexto = `Válida hasta: ${licencia.expiracion}`;
            }

            claveLicenciaAsociada = key;

            const socketAnteriorId = sesionesActivasPorLicencia[key];
            if (socketAnteriorId && socketAnteriorId !== socket.id) {
                io.to(socketAnteriorId).emit('sesion-expulsada', { 
                    mensaje: "Tu clave de acceso fue abierta en otro dispositivo." 
                });
            }

            sesionesActivasPorLicencia[key] = socket.id;

            socket.emit('respuesta-licencia', { 
                valida: true, 
                key: key, 
                expiracion: expiracionTexto 
            });
        } else {
            socket.emit('respuesta-licencia', { valida: false, mensaje: "Clave incorrecta o inactiva." });
        }
    });

    socket.on('probar-alerta', (data) => {
        let textoAlerta = '';
        let mensajeVisual = '';
        let customSoundUrl = null;
        const idiomaVoz = data.idioma || 'es';

        if (data.customSound) {
            customSoundUrl = guardarAudioBase64(data.customSound);
        }

        if (data.tipo === 'follow') {
            textoAlerta = "Gracias por seguirnos, Espectador de Prueba";
            mensajeVisual = "¡Espectador de Prueba comenzó a seguir el directo! 🎉 (Prueba)";
        } else if (data.tipo === 'gift') {
            textoAlerta = "Espectador de Prueba envió 5 Rosas";
            mensajeVisual = "🎁 ¡Espectador de Prueba envió 5x Rosas (50 diamantes)! (Prueba)";
        }

        if (textoAlerta) {
            generarYEnviarAudio(socket, textoAlerta, "ALERTA PRUEBA", mensajeVisual, true, customSoundUrl, idiomaVoz);
        }
    });

    socket.on('reproducir-efecto-rapido', (data) => {
        if (data.customSound) {
            let customSoundUrl = guardarAudioBase64(data.customSound);
            socket.emit('reproducir-audio', {
                soundUrl: customSoundUrl,
                audioUrl: null,
                usuario: "SOUNDBOARD",
                mensaje: "⚡ Efecto de sonido rápido activado",
                esAlerta: true
            });
        }
    });

    socket.on('desconectar-bot', () => {
        if (tiktokLiveConnection) {
            try { tiktokLiveConnection.disconnect(); } catch (e) {}
        }
        tiktokLiveConnection = null;
        socket.emit('estado-conexion', { status: 'desconectado' });
    });

    socket.on('configurar-usuario', (config) => {
        cargarLicencias();
        if (!config.licenseKey || !licenciasValidas[config.licenseKey]) {
            socket.emit('estado-conexion', { status: 'error', message: 'Licencia no autorizada.' });
            return;
        }

        if (sesionesActivasPorLicencia[config.licenseKey] !== socket.id) {
            socket.emit('estado-conexion', { status: 'error', message: 'Sesión duplicada o invalidada.' });
            return;
        }

        configuracionCliente = config;
        const username = config.username;
        const leerNombre = config.leerNombre;
        const leerEmojis = config.leerEmojis || false;
        const rolesConfig = config.roles || { todos: true, seguidores: false, moderadores: false, suscriptores: false };
        const tipoComentario = config.tipoComentario || 'todos';
        const textoComando = config.textoComando || '!tts';
        const palabrasProhibidas = config.palabrasProhibidas || [];
        const idiomaVoz = config.idiomaVoz || 'es';
        
        if (tiktokLiveConnection) {
            try { tiktokLiveConnection.disconnect(); } catch (e) {}
        }

        tiktokLiveConnection = new TikTokLiveConnection(username, {});
        let tiempoDeInicio = Date.now();
        let intentosReconexion = 0;
        const maxIntentos = 5;

        function conectarConReintento() {
            tiktokLiveConnection.connect().then(state => {
                socket.emit('estado-conexion', { status: 'conectado', room: state.roomId });
                intentosReconexion = 0;
            }).catch(err => {
                if (intentosReconexion < maxIntentos) {
                    intentosReconexion++;
                    let tiempoEspera = Math.min(10000 * Math.pow(2, intentosReconexion - 1), 60000);
                    socket.emit('estado-conexion', { status: 'error', message: `Reintentando en ${tiempoEspera / 1000}s...` });
                    setTimeout(() => conectarConReintento(), tiempoEspera);
                } else {
                    socket.emit('estado-conexion', { status: 'error', message: 'Límite de reintentos alcanzado.' });
                }
            });
        }

        conectarConReintento();

        tiktokLiveConnection.on('like', data => {
            const usernameLike = limpiarTexto(data.user ? data.user.nickname : 'Anonimo', leerEmojis);
            const count = data.likeCount || 1;

            if (!rankingLikes[usernameLike]) rankingLikes[usernameLike] = 0;
            rankingLikes[usernameLike] += count;

            const topLikes = Object.entries(rankingLikes)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([user, likes]) => ({ user, likes }));

            io.emit('actualizar-ranking-likes', topLikes);
        });

        tiktokLiveConnection.on('chat', data => {
            const tiempoMensaje = parseInt(data.common.createTime);
            if (tiempoMensaje < tiempoDeInicio) return;

            const mensajeLimpio = limpiarTexto(data.content, leerEmojis);
            const nombreLimpio = limpiarTexto(data.user.nickname, leerEmojis);

            if (mensajeLimpio === '' || contienePalabraProhibida(mensajeLimpio, palabrasProhibidas)) return;

            const esSeguidor = data.followInfo && data.followInfo.following === true;
            const esModerator = data.isModerator === true;
            const esSubscriptor = data.user.userBadges && data.user.userBadges.some(b => b.url && b.url.includes('sub'));

            if (!rolesConfig.todos) {
                let autorizado = false;
                if (rolesConfig.seguidores && esSeguidor) autorizado = true;
                if (rolesConfig.moderadores && esModerator) autorizado = true;
                if (rolesConfig.suscriptores && esSubscriptor) autorizado = true;
                if (!autorizado) return;
            }

            if (tipoComentario === 'punto' && !mensajeLimpio.startsWith('.')) return;
            if (tipoComentario === 'barra' && !mensajeLimpio.startsWith('/')) return;
            if (tipoComentario === 'comando' && !mensajeLimpio.startsWith(textoComando)) return;

            let textoALeer = leerNombre ? `${nombreLimpio} dice ${mensajeLimpio}` : mensajeLimpio;
            generarYEnviarAudio(socket, textoALeer, nombreLimpio, mensajeLimpio, false, null, idiomaVoz);
        });

        tiktokLiveConnection.on('social', data => {
            const alertas = configuracionCliente ? configuracionCliente.alertas : { follow: true };
            if (!alertas.follow) return;

            const nombreLimpio = limpiarTexto(data.user.nickname, leerEmojis);
            const esSeguir = data.displayType && data.displayType.includes('follow');

            if (esSeguir || data.actionId === 3) {
                const textoAlerta = `Gracias por seguirnos, ${nombreLimpio}`;
                const mensajeVisual = `¡${nombreLimpio} comenzó a seguir el directo! 🎉`;
                let customSoundUrl = guardarAudioBase64(alertas.soundFollow);
                generarYEnviarAudio(socket, textoAlerta, "ALERTA TIKTOK", mensajeVisual, true, customSoundUrl, idiomaVoz);
            }
        });

        tiktokLiveConnection.on('gift', data => {
            const alertas = configuracionCliente ? configuracionCliente.alertas : { gift: true };
            if (!alertas.gift || (data.giftType === 1 && !data.repeatEnd)) return;

            const nombreLimpio = limpiarTexto(data.user.nickname, leerEmojis);
            const nombreRegalo = data.giftName || (data.gift && data.gift.name) || 'un regalo';
            const cantidad = data.repeatCount || 1;
            const diamantes = ((data.diamondCount !== undefined) ? data.diamondCount : ((data.gift && data.gift.diamondCount) || 0)) * cantidad;

            const textoAlerta = `${nombreLimpio} envió ${cantidad} ${nombreRegalo}`;
            const mensajeVisual = `🎁 ¡${nombreLimpio} envió ${cantidad}x ${nombreRegalo} (${diamantes} diamantes)!`;
            let customSoundUrl = guardarAudioBase64(alertas.soundGift);
            generarYEnviarAudio(socket, textoAlerta, "REGALO", mensajeVisual, true, customSoundUrl, idiomaVoz);
        });
    });

    socket.on('disconnect', () => {
        if (tiktokLiveConnection) {
            try { tiktokLiveConnection.disconnect(); } catch (e) {}
        }
        if (claveLicenciaAsociada && sesionesActivasPorLicencia[claveLicenciaAsociada] === socket.id) {
            delete sesionesActivasPorLicencia[claveLicenciaAsociada];
        }
    });
});

function generarYEnviarAudio(socket, textoALeer, usuario, mensajeVisual, esAlerta, customSoundUrl, idiomaVoz) {
    const nombreArchivo = `tts_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
    const rutaArchivo = path.join(dirTemp, nombreArchivo);

    const speech = new gTTS(textoALeer, idiomaVoz || 'es');
    speech.save(rutaArchivo, (err) => {
        if (err) return;

        socket.emit('reproducir-audio', {
            soundUrl: customSoundUrl,
            audioUrl: `/temp/${nombreArchivo}`,
            usuario: usuario,
            mensaje: mensajeVisual,
            esAlerta: esAlerta
        });

        setTimeout(() => {
            try {
                if (fs.existsSync(rutaArchivo)) fs.unlinkSync(rutaArchivo);
            } catch (e) {}
        }, 15000);
    });
}

const RENDER_URL = 'https://bot-tiktok-cloud.onrender.com';
setInterval(() => {
    https.get(RENDER_URL, (res) => {}).on('error', (err) => {});
}, 300000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Servidor SaaS corriendo en http://localhost:${PORT}`);
});