const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password_hash: {
      type: String,
      required: false, // Optional for Google OAuth users
    },
    google_id: {
      type: String,
      sparse: true,
    },
    avatar: {
      type: String,
      default: '',
    },
    auth_provider: {
      type: String,
      default: 'local',
      enum: ['local', 'google'],
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('User', userSchema);
