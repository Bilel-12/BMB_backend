const jwt = require("jsonwebtoken");

const generateToken = (res, userId) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "30d", // Token expiration
  });

  // Set the token as an HTTP-only cookie
  res.cookie("jwt", token, {
    httpOnly: true, // Cookie can't be accessed via client-side scripts
    secure: process.env.NODE_ENV === "production", // Only use HTTPS in production
    sameSite: "None", // Ensures cookie is sent only to same-site requests
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
};


module.exports = generateToken
