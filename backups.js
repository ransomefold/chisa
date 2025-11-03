// ... (previous imports)
import mime from "mime-types"; // We'll add mime-type support for better file handling

class ChisaServer {
    constructor(options = {}) {
        // ... (previous constructor code)
        this.staticPaths = new Map(); // Store static file directories
    }

    // Add static file serving middleware
    static(urlPath, dirPath, options = {}) {
        if (!urlPath || !dirPath) {
            throw new TypeError('URL path and directory path are required');
        }

        const staticOptions = {
            index: options.index || 'index.html',
            dotfiles: options.dotfiles || 'ignore', // 'allow', 'deny', 'ignore'
            etag: options.etag !== false,
            maxAge: options.maxAge || 0, // Cache control max-age in milliseconds
            ...options
        };

        this.staticPaths.set(urlPath, {
            dirPath: path.resolve(dirPath),
            options: staticOptions
        });

        return this;
    }

    // Enhanced file serving capabilities
    async #serveStaticFile(req, res, filePath, options = {}) {
        try {
            const stats = await fs.promises.stat(filePath);

            if (!stats.isFile()) {
                throw new HttpError(404, 'Not Found');
            }

            // Handle ETag for caching
            if (options.etag) {
                const etag = `W/"${stats.size}-${stats.mtime.getTime()}"`;
                res.setHeader('ETag', etag);

                if (req.headers['if-none-match'] === etag) {
                    res.status(304).end();
                    return;
                }
            }

            // Set headers
            const mimeType = mime.lookup(filePath) || 'application/octet-stream';
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Length', stats.size);
            
            if (options.maxAge) {
                res.setHeader('Cache-Control', `public, max-age=${Math.floor(options.maxAge / 1000)}`);
            }

            // Enhanced sendFile with Range support
            if (req.headers.range) {
                const range = req.headers.range;
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
                
                if (start >= stats.size || end >= stats.size) {
                    res.setHeader('Content-Range', `bytes */${stats.size}`);
                    res.status(416).end(); // Range Not Satisfiable
                    return;
                }

                res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Content-Length', end - start + 1);
                res.status(206); // Partial Content

                const stream = fs.createReadStream(filePath, { start, end });
                stream.pipe(res);
            } else {
                const stream = fs.createReadStream(filePath);
                stream.pipe(res);
            }

        } catch (err) {
            if (err.code === 'ENOENT') {
                throw new HttpError(404, 'File Not Found');
            }
            throw err;
        }
    }

    // Enhanced response object with improved file handling
    #enhanceResponse(res) {
        // ... (previous response enhancements)

        // Enhanced sendFile method
        res.sendFile = async (filePath, options = {}) => {
            try {
                const absolutePath = path.resolve(filePath);
                await this.#serveStaticFile(req, res, absolutePath, options);
            } catch (err) {
                throw new HttpError(err.status || 500, err.message);
            }
        };

        // Add download method
        res.download = async (filePath, filename) => {
            try {
                const absolutePath = path.resolve(filePath);
                const stats = await fs.promises.stat(absolutePath);

                if (!stats.isFile()) {
                    throw new HttpError(404, 'File Not Found');
                }

                res.setHeader('Content-Disposition', `attachment; filename="${filename || path.basename(filePath)}"`);
                await this.#serveStaticFile(req, res, absolutePath);
            } catch (err) {
                throw new HttpError(err.status || 500, err.message);
            }
        };
    }

    // Enhanced request handling for static files
    async #handleStaticFiles(req, res) {
        for (const [urlPath, { dirPath, options }] of this.staticPaths) {
            if (req.path.startsWith(urlPath)) {
                const relativePath = req.path.slice(urlPath.length);
                const absolutePath = path.join(dirPath, relativePath);

                // Prevent path traversal attacks
                if (!absolutePath.startsWith(dirPath)) {
                    throw new HttpError(403, 'Forbidden');
                }

                try {
                    const stats = await fs.promises.stat(absolutePath);

                    if (stats.isDirectory()) {
                        if (options.index) {
                            const indexPath = path.join(absolutePath, options.index);
                            return await this.#serveStaticFile(req, res, indexPath, options);
                        }
                        throw new HttpError(404, 'Not Found');
                    }

                    // Handle dotfiles
                    if (path.basename(absolutePath).startsWith('.')) {
                        switch (options.dotfiles) {
                            case 'deny':
                                throw new HttpError(403, 'Forbidden');
                            case 'ignore':
                                throw new HttpError(404, 'Not Found');
                            // 'allow' - continue normally
                        }
                    }

                    return await this.#serveStaticFile(req, res, absolutePath, options);
                } catch (err) {
                    if (err.code === 'ENOENT') {
                        continue; // Try next static path
                    }
                    throw err;
                }
            }
        }
        return false; // No static file found
    }

    listen(port, callback) {
        const server = http.createServer(async (req, res) => {
            try {
                this.#enhanceResponse(res);
                await this.#parseRequest(req);

                // Try serving static files first
                const staticServed = await this.#handleStaticFiles(req, res);
                if (staticServed) return;

                // ... (rest of the listen method remains the same)
            } catch (err) {
                this.#handleError(err, req, res);
            }
        });

        // ... (rest of the listen method remains the same)
    }
}