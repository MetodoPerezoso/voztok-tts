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

// Configuración de GitHub API para persistencia real
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Tu token de GitHub en variables de entorno
const GITHUB_REPO = process.env.GITHUB_REPO;   // Ej: "tu-usuario/nombre-repo"
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// Función para leer licencias (intenta leer local o respaldado)
function cargarLicencias() {
    try {
        const filePath = path.join(__dirname, 'licenses.json');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            licenciasValidas = JSON.parse(data);
        }
    } catch (e) {
        console.error("❌ Error leyendo licenses.json:", e);
    }
}

cargarLicencias();

// FUNCIÓN CLAVE: Guarda los cambios directamente en GitHub vía API
async function guardarLicenciasEnGitHub(nuevoObjetoLicencias) {
    licenciasValidas = nuevoObjetoLicencias;
    const filePath = path.join(__dirname, 'licenses.json');
    
    // 1. Guardar localmente en el servidor para uso inmediato
    fs.writeFileSync(filePath, JSON.stringify(licenciasValidas, null, 4), 'utf8');

    // 2. Si las credenciales de GitHub están configuradas, actualizar el repo en la nube
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
        console.log("⚠️ GITHUB_TOKEN o GITHUB_REPO no configurados. Los cambios solo se guardaron localmente.");
        return;
    }

    try {
        const contenidoBase64 = Buffer.from(JSON.stringify(licenciasValidas, null, 4)).toString('base64');
        const apiPath = `https://api.github.com/repos/${GITHUB_REPO}/contents/licenses.json`;

        // Obtener el SHA actual del archivo (requisito de la API de GitHub)
        const getOptions = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_REPO}/contents/licenses.json`,
            method: 'GET',
            headers: {
                'User-Agent': 'Voztok-SaaS',
                'Authorization': `Bearer ${GITHUB_TOKEN}`
            }
        };

        let fileSha = '';
        await new Promise((resolve) => {
            https.get(getOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.sha) fileSha = json.sha;
                    } catch (e) {}
                    resolve();
                });
            }).on('error', () => resolve());
        });

        // Enviar actualización a GitHub
        const payload = JSON.stringify({
            message: "Actualización automática de licencias desde Panel Admin Voztok",
            content: contenidoBase64,
            sha: fileSha,
            branch: GITHUB_BRANCH
        });

        const putOptions = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_REPO}/contents/licenses.json`,
            method: 'PUT',
            headers: {
                'User-Agent': 'Voztok-SaaS',
                'Authorization': `Bearer ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        await new Promise((resolve, reject) => {
            const req = https.request(putOptions, (res) => {
                if (res.statusCode === 200 || res.statusCode === 201) {
                    console.log("☁️ Licencias sincronizadas y guardadas en GitHub exitosamente.");
                    resolve();
                } else {
                    res.on('data', d => console.error("❌ Error API GitHub:", d.toString()));
                    reject();
                }
            });
            req.on('error', e => reject(e));
            req.write(payload);
            req.end();
        });

    } catch (err) {
        console.error("❌ Error al conectar con GitHub API:", err);
    }
}

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
                <button class="btn-green" onclick="generarLoteAdmin()">Crear y Guardar en GitHub</button>
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
                    const res = await fetch('/api/admin/licencias', { headers: { 'x-admin-pass': pass } });
                    if(res.status === 403) { alert("Contraseña incorrecta"); return; }
                    const data = await res.json();
                    const tbody = document.getElementById('tablaLicencias');
                    tbody.innerHTML = '';
                    for (const [key, info] of Object.entries(data)) {
                        tbody.innerHTML += `
                            <tr>
                                <td><code style="color: #38bdf8; font-size: 13px; font-weight: bold;">${key}</code></td>
                                <td>
                                    <label style="cursor:pointer; font-size: 12px;">
                                        <input type="checkbox" ${info.activa ? 'checked' : ''} onchange="toggleActiva('${key}', this.checked)" style="width:auto; cursor:pointer;"> 
                                        ${info.activa ? '<span class="badge-activo">Activa</span>' : '<span class="badge-inactivo">Inactiva</span>'}
                                    </label>
                                </td>
                                <td><input type="date" class="input-fecha" value="${info.expiracion || ''}" onchange="guardarFecha('${key}', this.value)"></td>
                                <td><input type="text" class="input-nota" value="${info.nota || ''}" placeholder="Ej: @usuario" onchange="guardarNota('${key}', this.value)"></td>
                                <td><button onclick="extenderLicencia('${key}')" style="padding: 5px; font-size: 11px; background: #0284c7; width: auto;">+30 Días</button></td>
                            </tr>
                        `;
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
                    alert("¡Lote generado y guardado en GitHub con éxito!");
                    cargarLicencias();
                }
                async function extenderLicencia(key) {
                    const pass = document.getElementById('adminPass').value;
                    await fetch('/api/admin/extender', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-pass': pass },
                        body: JSON.stringify({ key })
                    });
                    cargarLicencias();
                }
                async function toggleActiva(key, activa) {
                    const pass = document.getElementById('adminPass').value;
                    await fetch('/api/admin/actualizar-estado', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-admin-pass': pass },
                        body: JSON.stringify({ key, activa })
                    });
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
    if (pass === ADMIN_SECRET) next();
    else res.status(403).json({ error: "No autorizado" });
};

app.get('/api/admin/licencias', verificarAdmin, (req, res) => {
    cargarLicencias();
    res.json(licenciasValidas);
});

app.post('/api/admin/generar', express.json(), verificarAdmin, async (req, res) => {
    const cantidad = req.body.cantidad || 5;
    cargarLicencias();
    const conjuntoExistentes = new Set(Object.keys(licenciasValidas));

    const generarBloque = (longitud = 3) => {
        const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let resStr = '';
        for (let i = 0; i < longitud; i++) resStr += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
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
            licenciasValidas[nuevaClave] = { "activa": true, "expiracion": fechaStr, "nota": "Disponible" };
            creadas++;
        }
    }

    await guardarLicenciasEnGitHub(licenciasValidas);
    res.json({ success: true, total: Object.keys(licenciasValidas).length });
});

app.post('/api/admin/extender', express.json(), verificarAdmin, async (req, res) => {
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

        await guardarLicenciasEnGitHub(licenciasValidas);
        return res.json({ success: true, nuevaExpiracion: licenciasValidas[key].expiracion });
    }
    res.status(404).json({ error: "No encontrada" });
});

app.post('/api/admin/actualizar-estado', express.json(), verificarAdmin, async (req, res) => {
    const { key, activa } = req.body;
    cargarLicencias();
    if (licenciasValidas[key]) {
        licenciasValidas[key].activa = activa;
        await guardarLicenciasEnGitHub(licenciasValidas);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "No encontrada" });
});

app.post('/api/admin/actualizar-nota', express.json(), verificarAdmin, async (req, res) => {
    const { key, nota } = req.body;
    cargarLicencias();
    if (licenciasValidas[key]) {
        licenciasValidas[key].nota = nota;
        await guardarLicenciasEnGitHub(licenciasValidas);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "No encontrada" });
});

app.post('/api/admin/actualizar-fecha', express.json(), verificarAdmin, async (req, res) => {
    const { key, expiracion } = req.body;
    cargarLicencias();
    if (licenciasValidas[key]) {
        licenciasValidas[key].expiracion = expiracion || null;
        await guardarLicenciasEnGitHub(licenciasValidas);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "No encontrada" });
});
// ==========================================

// [El resto de las funciones de socket.io, gTTS y conexión de TikTok quedan exactamente igual...]
// (Asegúrate de conservar el bloque del servidor inferior tal como lo tenías)