const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true,
        unique: true 
    },
    description: String,
    color: { 
        type: String, 
        default: '#25D366' 
    },
    filters: {
        businessType: [String],
        location: [String],
        minMessages: { type: Number, default: 0 },
        maxMessages: { type: Number, default: 1000 },
        status: { type: String, default: 'active' },
        lastContacted: {
            from: Date,
            to: Date
        }
    },
    contactCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Category', categorySchema);
