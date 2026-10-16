# Pirañalab Pedidos

Gestor compartido para administrar pedidos de impresión 3D, clientes, cotizaciones, vencimientos e historial. Usa React, TypeScript, Vite y Supabase Auth, PostgreSQL y Storage privado. Las personas autorizadas consultan los mismos datos desde distintos dispositivos.

## Requisitos y desarrollo local

Requiere Node.js 20 o posterior y npm.

```sh
npm install
cp .env.example .env.local
# Completar VITE_SUPABASE_ANON_KEY en .env.local
npm run dev
```

La URL de este proyecto Supabase ya está en `.env.example`. Copiá en `.env.local` la clave pública `anon` o `publishable` desde Supabase → Project Settings → API Keys. Nunca uses `service_role`/`secret` en el frontend ni la subas a GitHub.

## Preparar Supabase

1. Abrí el proyecto `omuawzpstpixojtqmpsm` en Supabase → SQL Editor.
2. Ejecutá `supabase/migrations/001_initial.sql`. Crea perfiles, clientes, pedidos, actividad, secuencia para códigos PIR, bucket privado de imágenes y reglas RLS.
3. Ejecutá `supabase/migrations/002_order_delivery.sql` para agregar dirección, localidad y costo de envío a los pedidos.
4. En Authentication → Sign In / Providers, deshabilitá los registros públicos. En Authentication → Users, creá una cuenta para cada integrante autorizado.
5. Para habilitar cada cuenta, copiá su UUID de Authentication → Users y ejecutá en SQL Editor:

   ```sql
   insert into public.profiles(id, display_name, role)
   values ('UUID_DEL_USUARIO', 'Nombre', 'admin');
   ```

   Repetí el paso para cada integrante. Sin un perfil autorizado, RLS bloquea la lectura y escritura.
6. En Authentication → URL Configuration, configurá como Site URL `https://esanchez18.github.io/Gestor-de-pedidos/` y agregá esa misma dirección a Redirect URLs. Agregá también `http://localhost:5173/` para desarrollo local.

La clave pública de frontend no da acceso por sí sola: las tablas y Storage están protegidos por RLS. Nunca copies una clave `service_role`/`secret` al navegador.

## Comandos

```sh
npm run dev       # desarrollo local
npm run typecheck # verificación de TypeScript
npm run build     # build estático en dist/
npm run preview   # previsualización local del build
```

## GitHub Pages

El workflow `.github/workflows/pages.yml` compila y publica en cada push a `main`. En GitHub, abrí Settings → Secrets and variables → Actions → Variables y agregá:

- `VITE_SUPABASE_ANON_KEY` = la clave pública anon/publishable del proyecto

La clave pública queda incluida en el JavaScript público del sitio; la protección de los datos depende de Auth y RLS. No agregues claves secretas como variables `VITE_`.

En Settings → Pages, elegí GitHub Actions como fuente. La URL del sitio es `https://esanchez18.github.io/Gestor-de-pedidos/`.

## Respaldo y privacidad

Los pedidos son compartidos entre las cuentas que tengan perfil autorizado. Las imágenes quedan en un bucket privado y se muestran con enlaces temporales. Configurá respaldos de base de datos y de Storage desde Supabase y revisá las cuotas de tu plan a medida que aumente el uso. Las cotizaciones son importes cotizados; no se registran pagos.
