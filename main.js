// Chisa - A Lightweight Express-like Web Framework
// Author: ransomefold

import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { URL } from "url";

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'HttpError';
    }
}

class ChisaServer {
    constructor(options = {}) {
        this.routes = new Map();
        this.middlewares = [];
        this.errorHandlers = [];
        this.options = {
            maxBodySize: options.maxBodySize || 1024 * 1024,
            timeout: options.timeout || 30000,
            trustProxy: options.trustProxy || false,
            cors: options.cors || false
        };
    }
    
    useStatic(mountPath, folderPath) {
      if (!folderPath) {
        folderPath = mountPath;
        mountPath = "/";
      }
      const resolvedFolder = path.resolve(folderPath);
      this.middlewares.push({
        path: mountPath,
        handler: (req, res, next) => {
          if (req.method !== "GET" && req.method !== "HEAD") {
              return next();
          }
          const requestPath = decodeURIComponent(req.path.replace(mountPath, ""));
          const filePath = path.join(resolvedFolder, requestPath);
          if (!filePath.startsWith(resolvedFolder)) {
            return next();
          }
          let finalPath = filePath;
          if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            finalPath = path.join(filePath, "index.html");
          }
          if (!fs.existsSync(finalPath)) {
            return next();
          }
          
          const mimeTypes = {
              ".html": "text/html",
              ".css": "text/css",
              ".js": "application/javascript",
              ".json": "application/json",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".gif": "image/gif",
              ".svg": "image/svg+xml",
              ".ico": "image/x-icon",
              ".woff": "font/woff",
              ".woff2": "font/woff2"
          };
          const ext = path.extname(finalPath).toLowerCase();
          const contentType = mimeTypes[ext] || "application/octet-stream";
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "public, max-age=3600"); // 1 jam
          const stream = fs.createReadStream(finalPath);
          stream.on("error", () => next());
          stream.pipe(res);
        }
      });
      return this;
    }

    use(path, ...handlers) {
        if (typeof path === 'function') {
            handlers.unshift(path);
            path = '*';
        }
        
        handlers.forEach(handler => {
            if (typeof handler !== 'function') {
                throw new TypeError('Middleware must be a function');
            }
            
            if (handler.length === 4) {
                this.errorHandlers.push(handler);
            } else {
                this.middlewares.push({ path, handler });
            }
        });
        
        return this;
    }

    route(method, path, ...handlers) {
        if (!path || typeof path !== 'string') {
            throw new TypeError('Path must be a non-empty string');
        }
        
        handlers.forEach(handler => {
            if (typeof handler !== 'function') {
                throw new TypeError('Route handler must be a function');
            }
        });

        const key = `${method.toUpperCase()}:${path}`;
        this.routes.set(key, handlers);
        return this;
    }

    get(path, ...handlers) { 
        return this.route('GET', path, ...handlers);
    }
    post(path, ...handlers) { 
        return this.route('POST', path, ...handlers);
    }
    put(path, ...handlers) { 
        return this.route('PUT', path, ...handlers); 
    }
    delete(path, ...handlers) { 
        return this.route('DELETE', path, ...handlers);
    }
    patch(path, ...handlers) { 
        return this.route('PATCH', path, ...handlers); 
    }
    options(path, ...handlers) { 
        return this.route('OPTIONS', path, ...handlers); 
    }
    
    parseParams(route, url) {
        const routeParts = route.split('/').filter(Boolean);
        const urlParts = url.split('/').filter(Boolean);
        const params = {};
        
        if (routeParts.length !== urlParts.length) return null;

        for (let i = 0; i < routeParts.length; i++) {
            const routePart = routeParts[i];
            const urlPart = urlParts[i];
            
            if (routePart.startsWith(':')) {
                params[routePart.slice(1)] = decodeURIComponent(urlPart);
            } else if (routePart !== urlPart) {
                return null;
            }
        }
        return params;
    }

    #securityMiddleware(req, res, next) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        
        if (this.options.cors) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        }

        req.id = crypto.randomBytes(16).toString('hex');
        res.setHeader('X-Request-ID', req.id);

        next();
    }

    #enhanceResponse(res) {
        res.json = (data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        };
        
        res.status = (code) => {
            res.statusCode = code;
            return res;
        };
        
        res.send = (data) => {
            if (typeof data === 'object') {
                return res.json(data);
            }
            res.setHeader('Content-Type', 'text/plain');
            res.end(String(data));
        };
        
        res.redirect = (status, url) => {
            if (!url) {
                url = status;
                status = 302;
            }
            res.writeHead(status, { Location: url });
            res.end();
        };
        
        res.sendFile = (filePath) => {
            const stream = fs.createReadStream(filePath);
            stream.pipe(res);
        };
    }
    
    async #parseRequest(req) {
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        req.path = parsedUrl.pathname;
        req.query = Object.fromEntries(parsedUrl.searchParams);
        
        const cookies = req.headers.cookie?.split(';') || [];
        req.cookies = {};
        cookies.forEach(cookie => {
            const [key, value] = cookie.trim().split('=');
            req.cookies[key] = decodeURIComponent(value);
        });
        
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            const contentType = req.headers['content-type'];
            const body = await new Promise((resolve, reject) => {
                let data = '';
                let size = 0;
                
                req.on('data', chunk => {
                    size += chunk.length;
                    if (size > this.options.maxBodySize) {
                        reject(new HttpError(413, 'Payload Too Large'));
                        req.destroy();
                    }
                    data += chunk;
                });
                
                req.on('end', () => {
                    if (contentType?.includes('application/json')) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new HttpError(400, 'Invalid JSON'));
                        }
                    } else {
                        resolve(data);
                    }
                });
                
                req.on('error', reject);
            });

            req.body = body;
        }
    }

    #handleError(err, req, res) {
        console.error(`[${req.id}] Error:`, err);

        if (this.errorHandlers.length) {
            this.errorHandlers[0](err, req, res, (err) => {
                if (err) {
                    res.status(500).send('Internal Server Error');
                }
            });
        } else {
            const status = err.status || 500;
            const message = process.env.NODE_ENV === 'production' 
                ? status === 500 ? 'Internal Server Error' : err.message
                : err.stack;
            
            res.status(status).send({ error: message });
        }
    }

    listen(port, callback) {
        const server = http.createServer(async (req, res) => {
            try {
                this.#enhanceResponse(res);
                await this.#parseRequest(req);
                
                await new Promise((resolve) => {
                    this.#securityMiddleware(req, res, resolve);
                });
                
                let routeHandlers = null;
                let params = null;
                for (const [key, handlers] of this.routes) {
                    const [method, path] = key.split(':');
                    if (method === req.method) {
                        params = this.parseParams(path, req.path);
                        if (params !== null) {
                            routeHandlers = handlers;
                            break;
                        }
                    }
                }
                if (!routeHandlers) {
                    throw new HttpError(404, 'Not Found');
                }
                req.params = params;
                let middlewareIndex = 0;
                const executeMiddleware = async () => {
                    if (middlewareIndex < this.middlewares.length) {
                        const { path, handler } = this.middlewares[middlewareIndex++];
                        if (path === '*' || req.path.startsWith(path)) {
                            await new Promise((resolve, reject) => {
                                handler(req, res, (err) => {
                                    if (err) reject(err);
                                    else resolve();
                                });
                            });
                            await executeMiddleware();
                        }
                    }
                };
                
                await executeMiddleware();
                
                for (const handler of routeHandlers) {
                    await new Promise((resolve, reject) => {
                        handler(req, res, (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                }
            } catch (err) {
                this.#handleError(err, req, res);
            }
        });
        
        server.timeout = this.options.timeout;
        
        server.listen(port, () => {
            console.log(`🌸 Chisa server is running on port ${port}`);
            if (callback) callback();
        });

        return server;
    }
}

export default function Chisa(options) {
    return new ChisaServer(options);
}

export { HttpError };