// Chisa - A Lightweight Express-like Web Framework
// Author: ransomefold
// Enhanced Version with Security & Features

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
            maxBodySize: options.maxBodySize || 1024 * 1024, // 1MB default
            timeout: options.timeout || 30000, // 30 seconds default
            trustProxy: options.trustProxy || false,
            cors: options.cors || false
        };
    }

    // Enhanced middleware support
    use(path, ...handlers) {
        if (typeof path === 'function') {
            handlers.unshift(path);
            path = '*';
        }
        
        handlers.forEach(handler => {
            if (typeof handler !== 'function') {
                throw new TypeError('Middleware must be a function');
            }
            
            if (handler.length === 4) { // Error handling middleware
                this.errorHandlers.push(handler);
            } else {
                this.middlewares.push({ path, handler });
            }
        });
        
        return this;
    }

    // Enhanced routing methods
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

    // HTTP method handlers
    get(path, ...handlers) { return this.route('GET', path, ...handlers); }
    post(path, ...handlers) { return this.route('POST', path, ...handlers); }
    put(path, ...handlers) { return this.route('PUT', path, ...handlers); }
    delete(path, ...handlers) { return this.route('DELETE', path, ...handlers); }
    patch(path, ...handlers) { return this.route('PATCH', path, ...handlers); }
    options(path, ...handlers) { return this.route('OPTIONS', path, ...handlers); }

    // Enhanced parameter parsing
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

    // Security middleware
    #securityMiddleware(req, res, next) {
        // Add security headers
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        
        // CORS support
        if (this.options.cors) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        }

        // Generate request ID
        req.id = crypto.randomBytes(16).toString('hex');
        res.setHeader('X-Request-ID', req.id);

        next();
    }

    // Enhanced response object
    #enhanceResponse(res) {
        // JSON response
        res.json = (data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        };

        // Status chain
        res.status = (code) => {
            res.statusCode = code;
            return res;
        };

        // Send response
        res.send = (data) => {
            if (typeof data === 'object') {
                return res.json(data);
            }
            res.setHeader('Content-Type', 'text/plain');
            res.end(String(data));
        };

        // Redirect
        res.redirect = (status, url) => {
            if (!url) {
                url = status;
                status = 302;
            }
            res.writeHead(status, { Location: url });
            res.end();
        };

        // Send File
        res.sendFile = (filePath) => {
            const stream = fs.createReadStream(filePath);
            stream.pipe(res);
        };
    }

    // Enhanced request parsing
    async #parseRequest(req) {
        // Parse URL and query parameters
        const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
        req.path = parsedUrl.pathname;
        req.query = Object.fromEntries(parsedUrl.searchParams);

        // Parse cookies
        const cookies = req.headers.cookie?.split(';') || [];
        req.cookies = {};
        cookies.forEach(cookie => {
            const [key, value] = cookie.trim().split('=');
            req.cookies[key] = decodeURIComponent(value);
        });

        // Parse body for POST/PUT/PATCH
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

    // Error handling
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
                // Enhance request and response objects
                this.#enhanceResponse(res);
                await this.#parseRequest(req);

                // Add security middleware
                await new Promise((resolve) => {
                    this.#securityMiddleware(req, res, resolve);
                });

                // Find matching route
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

                // Add params to request
                req.params = params;

                // Execute middleware chain
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

                // Execute route handlers
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

        // Add server timeout
        server.timeout = this.options.timeout;

        // Start listening
        server.listen(port, () => {
            console.log(`🌸 Chisa server is running on port ${port}`);
            if (callback) callback();
        });

        return server;
    }
}

// Factory function
export default function Chisa(options) {
    return new ChisaServer(options);
}

// Export error class for custom error handling
export { HttpError };