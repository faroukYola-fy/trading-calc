const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    passwordSalt: {
      type: String,
      required: true,
      select: false,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    role: {
      type: String,
      enum: ["crypto_trader", "forex_trader", "tutor"],
      required: true,
    },
    avatarUrl: {
      type: String,
      default: "",
      trim: true,
    },
    walletAddress: {
      type: String,
      default: "",
      trim: true,
    },
    preferredTradingStyle: {
      type: String,
      enum: ["scalp", "day_trade", "swing"],
      default: "scalp",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
