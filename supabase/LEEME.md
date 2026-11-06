# Activar el portal de JMPERFORMANCE (Supabase)

Tiempo: unos 15 minutos. Es gratis para el tamaño de un gimnasio.

## 1. Crear el proyecto
1. Entra a https://supabase.com → **Start your project** → inicia sesión con GitHub.
2. **New project** → nombre `jmperformance`, región **South America (São Paulo)**, crea una contraseña para la base de datos y guárdala.
3. Espera 1–2 minutos a que se cree.

## 2. Crear las tablas y permisos
1. Menú izquierdo → **SQL Editor** → **New query**.
2. Copia y pega todo el archivo `supabase/schema.sql` → **Run**. Debe decir "Success".

3. Ejecuta `supabase/002_admin_role.sql` en **dos partes**: primero solo la PARTE 1 → Run; luego la PARTE 2 → Run.

## 3. Configurar el inicio de sesión
1. **Authentication → Sign In / Providers**: desactiva **Allow new users to sign up** (nadie puede registrarse solo) y **Confirm email** → Save.
   Las cuentas las crean recepción, el propietario o el administrador desde el portal, a través de `api/create-user.js` en Vercel.
2. Ejecuta `supabase/003_service_role.sql` en el SQL Editor.
3. **Vercel → proyecto → Settings → Environment Variables**: agrega `SUPABASE_SERVICE_ROLE_KEY` con la clave **secret / service_role** de Supabase (Project Settings → API Keys). Luego **Redeploy**.
2. **Authentication → URL Configuration**:
   - **Site URL**: `https://jmperformance-six.vercel.app`
   - **Redirect URLs**: agrega `https://jmperformance-six.vercel.app/portal.html` y `http://localhost:8000/portal.html`

## 4. Conectar el sitio
1. **Project Settings → API**. Copia:
   - **Project URL**
   - **anon public** key (NO la `service_role`)
2. Pégalas en `config.js`.

## 5. Convertirte en propietario
1. Abre `portal.html` en tu sitio → **Crear cuenta** con tu correo.
2. Vuelve a **SQL Editor** y ejecuta (con tu correo):
   ```sql
   update public.profiles set role = 'propietario' where email = 'tu@correo.com';
   ```
3. Cierra sesión y vuelve a entrar: ya verás Resumen, Socios, Asistencia, Pagos y Permisos.

## Uso diario
- **Nuevo socio**: Socios → Nuevo socio. Se crea su usuario (correo) y una contraseña inicial que le entregas.
- **Empleados**: Permisos → Nuevo empleado, o cambia el permiso de cualquier usuario en la lista.
- **Asistencia**: Asistencia → Escanear QR con la cámara del celular/tablet de recepción.
- **Rutinas**: Socios → ✏️ Editar → "Rutina y objetivos". El cliente la ve en su cuenta.
- **Contraseña olvidada**: el cliente usa "¿Olvidaste tu contraseña?" y le llega un correo.
  Si no le llega, en Supabase → Authentication → Users → el usuario → **Send password recovery**.

## Permisos
| | Cliente | Empleado | Propietario |
|---|:-:|:-:|:-:|
| Ver su membresía, QR, rutina, pagos y asistencias | ✅ | ✅ | ✅ |
| Registrar socios, renovaciones, pagos, asistencia y rutinas | | ✅ | ✅ |
| Ver ingresos, anular pagos, exportar | | | ✅ |
| Cambiar permisos y desactivar cuentas | | | ✅ |

Los permisos los aplica la base de datos, no solo la página: aunque alguien manipule el navegador, un cliente nunca puede leer datos de otro cliente.

## Registro en línea y pagos por transferencia
1. Ejecuta `supabase/005_payment_requests.sql` en el SQL Editor (Run → "Success").
2. **Authentication → Sign In / Providers**: activa **Allow new users to sign up** → Save.
   (Deja **Confirm email** desactivado: el correo gratuito de Supabase solo envía unos pocos correos por hora.)
3. Listo: el botón **Regístrate ahora** de la página lleva a `portal.html?registro`. El cliente crea su cuenta,
   entra, elige plan y sube la foto de su transferencia. Queda en **Pagos por revisar** (menú del personal);
   al **Aprobar** se registra el pago y se activa o extiende la membresía. Al **Rechazar**, el cliente ve el motivo.

## Asistencia con huella digital o reconocimiento facial
El portal ya acepta marcaciones de equipos biométricos. El equipo reconoce a la persona por su cuenta y solo envía el
ID del cliente: la huella y el rostro **nunca** llegan a este sistema.
1. Ejecuta `supabase/006_attendance_method.sql` (guarda si la asistencia fue por QR, manual, huella o rostro).
2. **Vercel → Settings → Environment Variables**: agrega `DEVICE_KEY` con una clave secreta larga → **Redeploy**.
3. Registra a cada cliente en el equipo con su **ID de equipo** = número de su código (JMP0012 → `12`).
4. Configura el equipo (o su software) para enviar cada marcación:
   ```
   POST https://jmperformance-six.vercel.app/api/device-checkin
   x-device-key: <DEVICE_KEY>
   Content-Type: application/json
   {"pin":"12","method":"huella"}        ← o "facial"
   ```
   Respuesta: `{"ok":true,"name":"...","days_left":45}` o `{"ok":false,"error":"Membresía vencida..."}`.
5. Antes de registrar a un cliente, pide su **autorización por escrito** (en Ecuador los datos biométricos son datos sensibles).

## Pagos con tarjeta (PayPhone)
1. Ejecuta `supabase/004_orders.sql` en el SQL Editor.
2. En **Vercel → Settings → Environment Variables** agrega:
   - `PAYPHONE_TOKEN` → Token de PayPhone Developer (secreto)
   - `PAYPHONE_STORE_ID` → Store ID de PayPhone Developer
   - `PAYPHONE_RECARGO_PCT` → % de recargo por pago con tarjeta (ej. `5`). Si no existe, no se cobra recargo.
   Luego **Redeploy**. Mientras falten el Token o el Store ID, la pestaña "Tarjeta" muestra "próximamente".
3. En PayPhone Developer, la aplicación WEB debe tener:
   - Dominio: `https://jmperformance-six.vercel.app`
   - URL de respuesta: `https://jmperformance-six.vercel.app/pago.html`
4. Supabase → Authentication → URL Configuration debe incluir `https://jmperformance-six.vercel.app/portal.html` en Redirect URLs
   (lo usa el enlace "Crear mi contraseña" que recibe el cliente nuevo).

Flujo: el cliente paga → PayPhone lo devuelve a `pago.html` → `api/pay-confirm.js` confirma con PayPhone (antes de 5 min)
→ crea la cuenta o la encuentra por correo → extiende la membresía → registra el pago (método "PayPhone").
Cada intento queda en la tabla `orders` (pending / paid / canceled / error).
