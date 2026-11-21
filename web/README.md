# IntelliDoc web app

React + Vite + Mantine (Poppins and the Intellidoc blues, as on the run sheet).

    cd web
    npm install
    npm run dev        (http://localhost:5173; /api is proxied to the API on port 3001)
    npm run build      (writes dist/, which the API serves at /)
    npm test

For a quick look without a database, run `npm run dev:stub` in `api/` and `npm run dev` here.

Pages so far: **Settings** (with a change log). Next: Customers.
