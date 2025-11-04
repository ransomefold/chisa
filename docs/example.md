
## PENGGUNAAN BASIC
```javascript
import Chisa from "chisa";

const app = Chisa();

app.get("/", (req, res) => {
  res.send("Hello from Chisa 🌸");
});

app.listen(3000);
```

## ROUTE DANGAN PARAMS

```javascript
app.get("/user/:id", (req, res) => {
  res.json({ userId: req.params.id });
});
```

## QUERY PARAMS

```javascript
app.get("/search", (req, res) => {
  res.json({ q: req.query.q });
});
```

## JSON BODY PARSING

```javascript
app.post("/api/data", (req, res) => {
  res.json({ received: req.body });
});
```

## COOKIE PARSING

```javascript
app.get("/cookies", (req, res) => {
  res.json({ cookies: req.cookies });
});
```

## RESPONSE HELPER

```javascript
app.get("/helpers", (req, res) => {
  res
    .status(200)
    .json({ message: "Status + JSON OK" });
});
```

## REDIRECT 

```javascript
app.get("/yt", (req, res) => {
  res.redirect("https://youtube.com");
});
```

## SEND FILE

```javascript
import path from "path";

app.get("/file", (req, res) => {
  res.sendFile(path.join(process.cwd(), "test.txt"));
});
```

## MIDDLEWARE (GLOBAL)

```javascript
app.use((req, res, next) => {
  console.log(`[LOG] ${req.method} ${req.path}`);
  next();
});
```

## MIDDLEWARE (PATH SPECIFIC)

```javascript
app.use("/api", (req, res, next) => {
  console.log("Middleware API zone");
  next();
});
```

## ERROR HANDLING MIDDLEWARE

```javascript
app.use((err, req, res, next) => {
  console.error("Custom error handler:", err);
  res.status(500).json({ error: "Custom internal error"});
});
```

## CUSTOM HTTP ERROR

```javascript
import { HttpError } from "chisa";

app.get("/fail", () => {
  throw new HttpError(400, "Bad request example");
});
```

## 404 DEFAULT

```javascript
app.get("/nothing", () => {
  throw new HttpError(404, "Not found");
});
```