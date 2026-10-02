const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    file_name: {
      type: String,
      required: true,
    },
    file_path: {
      type: String,
      required: true,
    },
    file_url: {
      type: String,
      required: true,
    },
    extracted_text: {
      type: String,
      default: '',
    },
    uploaded_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('Document', documentSchema);
