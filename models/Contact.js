const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true, unique: true },
    name: String,
    businessType: String,
    location: String,
    tags: [String],
    lastContacted: Date,
    messageCount: { type: Number, default: 0 },
    status: { type: String, default: 'active' },
    notes: String,
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Contact', contactSchema);
