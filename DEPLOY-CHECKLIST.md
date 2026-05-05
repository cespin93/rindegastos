# Deploy checklist

## Backend Apps Script

1. Editar solo la copia activa de backend en `webapp/backend/Code.gs`.
2. Mantener sincronizado `webapp/backend/appsscript.json` con los scopes requeridos:
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/script.external_request`
   - `https://www.googleapis.com/auth/userinfo.email`
3. Subir también la misma versión a la copia de referencia en `backend/Code.gs`.
4. Confirmar que `APP_VERSION` cambió antes de desplegar.
5. En Apps Script, ejecutar manualmente `testDriveAccess()` cuando haya cambios de Drive/permisos.
6. Volver a desplegar el mismo Web App y revisar que el deployment ID siga siendo el esperado.
7. Probar `healthcheck` en el deployment publicado y confirmar la nueva `APP_VERSION`.
8. Si falla upload, probar `driveCheck` y `uploadProbe` antes de tocar el frontend.

## Frontend GitHub Pages

1. Confirmar que `js/config.js` apunta al deployment correcto de Apps Script.
2. Replicar en este repo cualquier cambio publicado en la app estática.
3. Subir cambios al repo público:
   - `git add .`
   - `git commit -m "..."`
   - `git push origin main`
4. Si se cambian assets cargados por caché, subir la versión en los `script src` o `link href` con `?v=`.
5. Hacer hard refresh en `https://cespin93.github.io/rindegastos/`.
6. Verificar dentro de la app que el badge muestre la `APP_VERSION` y el deployment esperado.

## Verificación mínima

1. Login correcto.
2. Dashboard carga sin errores.
3. Crear rendición individual con adjunto.
4. Abrir adjunto inline desde Dashboard/Aprobaciones/Contabilidad.
5. Confirmar que no aparezca `Acceso denegado: DriveApp` ni `Acción desconocida`.
