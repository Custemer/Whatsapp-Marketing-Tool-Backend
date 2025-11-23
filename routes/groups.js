const express = require("express");
const { getWhatsAppClient } = require("./pair");

const router = express.Router();

// Get all groups
router.get("/", async (req, res) => {
    try {
        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        const groups = await client.groupFetchAllParticipating();
        const groupList = Object.values(groups).map(group => ({
            id: group.id,
            name: group.subject,
            participants: group.participants.length,
            description: group.desc,
            created: group.creation
        }));

        res.json({ success: true, groups: groupList });
    } catch (error) {
        console.error('Groups error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Extract group members
router.get("/:groupId/members", async (req, res) => {
    try {
        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        const { groupId } = req.params;
        const group = await client.groupMetadata(groupId);
        
        const members = group.participants.map(participant => ({
            id: participant.id,
            phoneNumber: participant.id.split('@')[0],
            isAdmin: participant.admin !== null
        }));

        res.json({ success: true, members });
    } catch (error) {
        console.error('Group members error:', error);
        res.json({ success: false, error: error.message });
    }
});

module.exports = router;
