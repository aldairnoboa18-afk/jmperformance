# Agente biométrico — Hikvision DS-K1T342MFWX

Programa pequeño que corre **dentro del gimnasio** (Raspberry Pi o mini PC conectada al mismo router que el terminal) y conecta el terminal con la web:

- **Vigencias → terminal** (cada 5 min): carga a cada cliente con su número (`JMP0012` → ID `12`) y sus fechas. El terminal **solo abre el torniquete si la membresía está vigente**, aunque se caiga internet.
- **Ingresos → web** (cada 5 s): cada rostro o huella reconocida se registra como asistencia (`facial` / `huella`). Sin internet, los guarda y los envía cuando vuelve.
- El rostro y la huella **nunca salen del terminal**.

| Persona en la web | En el terminal |
|---|---|
| Cliente con membresía | Acceso desde inicio hasta vencimiento |
| Cliente sin membresía o cuenta desactivada | Bloqueado |
| Entrenador | Acceso siempre (cuenta como asistencia) |
| Empleado / propietario / admin | Acceso siempre (no cuenta como asistencia) |
| Pase diario (visitante) | No está en el terminal: recepción abre manualmente |

---

## 1. En Vercel (una sola vez)

1. Vercel → proyecto → **Settings → Environment Variables** → agrega `DEVICE_KEY` con una clave larga al azar.
2. **Redeploy**. Comprueba que `https://jmperformancecoca.com/api/device-checkin` responda `{"configured":true}`.

## 2. En el terminal Hikvision

1. **Encontrar la IP**: en la pantalla del terminal → menú (mantén presionado / ícono de engranaje, pide la clave de admin) → **Comunicación → WiFi** (o Red) → anota la **dirección IP** (ej. `192.168.1.64`).
2. Recomendado: pide al técnico o configura en el router una **IP fija** para el terminal (si cambia, el agente deja de encontrarlo).
3. **Hora**: en el panel web (`http://IP-del-terminal` → usuario `admin`) → Configuración → Sistema → Hora: zona **UTC-05:00** y **NTP** activado.
4. Registrar clientes: **no crees personas a mano**. El agente las crea solo con su ID. En el terminal busca la persona por su ID (el número de su código) y solo **agrega su rostro o huella**.

## 3. En la Raspberry Pi / mini PC

1. Instala **Node.js 18 o superior** (`node --version`).
2. Copia la carpeta `biometrico` al equipo.
3. Copia `config.ejemplo.json` como **`config.json`** y complétalo:
   - `terminal_ip`: la IP del paso 2
   - `terminal_clave`: la clave de `admin` del terminal
   - `clave_equipo`: la misma `DEVICE_KEY` de Vercel
4. Prueba: `node agente.js --probar` → todo debe salir con ✓.
5. Inicia: `node agente.js`

### Que arranque solo al encender (Raspberry Pi / Linux)

```bash
sudo cp jmp-biometrico.service /etc/systemd/system/
sudo nano /etc/systemd/system/jmp-biometrico.service   # ajusta la ruta y el usuario si no es /home/pi/biometrico
sudo systemctl enable --now jmp-biometrico
journalctl -u jmp-biometrico -f                          # ver lo que hace
```

### Que arranque solo al encender (Windows)

Programador de tareas → Crear tarea → Desencadenador **Al iniciar el sistema** → Acción: programa `node`, argumentos `agente.js`, iniciar en la carpeta `biometrico`. Marca "Ejecutar tanto si el usuario inició sesión como si no".

---

## Archivos

| Archivo | Qué es |
|---|---|
| `agente.js` | El programa |
| `config.json` | Tu configuración con claves (**no se sube a GitHub**) |
| `estado.json` | Lo que ya se sincronizó, ingresos pendientes (se crea solo) |
| `agente.log` | Registro de actividad (se crea solo) |

Si algo falla, revisa `agente.log` o ejecuta `node agente.js --probar`.
