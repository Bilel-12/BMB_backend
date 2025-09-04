const express = require('express')
const { getNotifications, transferPoints, updateTotalIncome, registerUser, authUser, logoutUser, getUserProfile, updateUserProfile, getTreeStats } = require("../controllers/userController.js");
const protect = require("../middleware/authMiddleware.js");

const router = express.Router();
// Inscription ouverte à tous, pas besoin de protection
router.post("/", protect, registerUser);

// Authentification et logout restent protégés ou non selon le besoin
router.post("/auth", authUser);
router.post("/logout", logoutUser);
router.get("/:userId/tree-stats", getTreeStats);

router
  .route("/profile")
  .get(protect, getUserProfile)
  .put(protect, updateUserProfile);

router.put("/transfer-points", protect, transferPoints);
router.get("/notifications", protect, getNotifications);
router.put("/total", protect, updateTotalIncome);








module.exports = router;
