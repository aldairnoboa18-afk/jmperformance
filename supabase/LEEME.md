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
1. **Authentication → Sign In / Providers → Email**: desactiva **Confirm email** (así las cuentas que crea recepción funcionan de inmediato) → Save.
2. **Authentication → URL Configuration**:
   - **Site URL**: la dirección de tu sitio, por ejemplo `https://aldairnoboa18-afk.github.io/jmperformance/`
   - **Redirect URLs**: agrega `https://aldairnoboa18-afk.github.io/jmperformance/portal.html`

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
