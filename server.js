const express = require("express");

const cookieParser = require("cookie-parser");
const connectDB = require("./config/db.js");
const { notFound, errorHandler } = require("./middleware/errorMiddleware.js");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const port = process.env.PORT || 5000;

connectDB();

const app = express();
const corsOptions = {

  origin: "https://bmbclients.netlify.app", // ton front Netlify

  credentials: true, // This allows cookies to be sent
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// const userRoutes = require("./routes/userRoutes.js");
app.use("/api/users", require("./routes/userRoutes.js"));

app.get("/", (req, res) => res.send("Server is ready"));

app.use(notFound);
app.use(errorHandler);


app.listen(port, () => console.log(`Server started on port ${port}`));
