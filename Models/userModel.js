const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const moment = require("moment"); // For formatting dates

const userSchema = mongoose.Schema(
  {
    nom: { type: String, required: true },
    prenom: { type: String, required: true },
    cin: { type: String, required: true, unique: true },
    pseudo: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    tel: { type: String, required: true },

    // 🔄 Nouveau système binaire
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    leftChildren: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    rightChildren: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    position: { type: String, enum: ["left", "right"], default: "left" },

    isBalanced: { type: Boolean, default: false },

    points: { type: Number, default: 45 },
    allpoints: { type: Number, default: 0 },
    pointstosend: { type: Number, default: 0 },

    password: { type: String, required: true },
    PasswordFack: { type: String },

    rank: {
      type: String,
      enum: ["Partenaire", "Silver", "Trainer", "Expert", "Leader", "Coach"],
      default: "Partenaire",
    },


    notifications: [
      {
        message: String,
        date: { type: Date, default: Date.now },
        isRead: { type: Boolean, default: false },
        solde: { type: Number, default: 0 },
        sign: { type: Number, default: "1" }
      },
    ],

    role: { type: String, default: "user" },
    lastLogin: { type: Date, default: null },

    createdAt: {
      type: String,
      default: () => moment().format("DD/MM/YYYY"),
    },
    updatedAt: {
      type: String,
      default: () => moment().format("DD/MM/YYYY"),
    },
  },
  { timestamps: false }
);

// 🔄 Mettre à jour `updatedAt`
userSchema.pre("save", function (next) {
  this.updatedAt = moment().format("DD/MM/YYYY");
  next();
});

// Vérification mot de passe
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Hash du mot de passe avant sauvegarde
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Mettre à jour le lastLogin
userSchema.methods.updateLastLogin = async function () {
  this.lastLogin = new Date();
  await this.save();
};

const User = mongoose.model("User", userSchema);

module.exports = User

