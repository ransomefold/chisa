
// INI GW BUAT SEMIRIP MUNGKIN DENGAN EXPRESS WKWKWK
// NIATNYA AGAR PADA TERBIASA AJA SIH 🗿
// NAMANYA KAWAII YA?
// BTW NGAPAIN PADA DISINI JIR?


// const http = require("http");
import http from "http";

class NekoliteServer {
    constructor() {
        this.routes = {};
        this.middlewares = [];
    }

    use(middleware) {
    	if (!typeof middleware === "function") return;
        this.middlewares.push(middleware);
    }

    get(path, handler) {
        this.routes[`GET:${path}`] = handler;
    }

    post(path, handler) {
        this.routes[`POST:${path}`] = handler;
    }

    parseParams(route, url) {
        const routeParts = route.split("/").filter(Boolean);
        const urlParts = url.split("/").filter(Boolean);
        const params = {};

        routeParts.forEach((part, i) => {
            if (part.startsWith(":")) {
                params[part.slice(1)] = urlParts[i];
            }
        });

        return params;
    }

    listen(port, callback) {
        const server = http.createServer((req, res) => {
            // Tambahin .send helper
            res.send = (statusOrData, data) => {
                let status = 200;
                let payload = statusOrData;

                if (typeof statusOrData === "number") {
                    status = statusOrData;
                    payload = data;
                }

                if (typeof payload === "object") {
                    res.writeHead(status, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(payload));
                } else {
                    res.writeHead(status, { "Content-Type": "text/plain" });
                    res.end(String(payload));
                }
            };

            let keyExact = `${req.method}:${req.url}`;
            let handler = this.routes[keyExact];

            if (!handler) {
                for (const routeKey in this.routes) {
                    const [method, route] = routeKey.split(":");
                    if (method === req.method && route.includes(":")) {
                        const routeParts = route.split("/").filter(Boolean);
                        const urlParts = (req.url || "").split("/").filter(Boolean);
                        if (routeParts.length === urlParts.length) {
                            handler = this.routes[routeKey];
                            req.params = this.parseParams(route, req.url || "");
                            break;
                        }
                    }
                }
            }

            if (!handler) {
                res.send(404, "404 Not Found - NL!");
                return;
            }

            let i = 0;
            const next = () => {
                const mw = this.middlewares[i++];
                if (mw) mw(req, res, next);
                else handler(req, res);
            };

            if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => (body += chunk));
                req.on("end", () => {
                    try { req.body = JSON.parse(body); }
                    catch { req.body = body; }
                    next();
                });
            } else {
                next();
            }
        });

        server.listen(port, callback);
    }
}

export default function Nekolite() {
    return new NekoliteServer();
}