const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
    phoneNumber: { 
        type: String, 
        required: true, 
        unique: true 
    },
    name: String,
    businessType: String,
    location: String,
    tags: [String],
    lastContacted: Date,
    messageCount: { type: Number, default: 0 },
    status: { 
        type: String, 
        default: 'active',
        enum: ['active', 'inactive', 'bounced', 'unsubscribed']
    },
    notes: String,
    categories: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Category' 
    }],
    whatsappStatus: {
        isOnWhatsApp: { type: Boolean, default: false },
        lastChecked: Date,
        profileName: String,
        profilePicture: String
    },
    source: {
        type: String,
        default: 'manual',
        enum: ['manual', 'detection', 'import', 'campaign']
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Update updatedAt on save
contactSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Contact', contactSchema);
