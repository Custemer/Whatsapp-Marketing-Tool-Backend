const express = require("express");
const Campaign = require("../models/Campaign");

const router = express.Router();

// Get all campaigns
router.get("/", async (req, res) => {
    try {
        const campaigns = await Campaign.find().sort({ createdAt: -1 });
        res.json({ success: true, campaigns });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new campaign
router.post("/", async (req, res) => {
    try {
        const { name, message, contacts } = req.body;

        const campaign = new Campaign({
            name,
            message,
            contacts: Array.isArray(contacts) ? contacts : contacts.split('\n').filter(num => num.trim() !== '')
        });

        await campaign.save();
        res.json({ success: true, campaign });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
