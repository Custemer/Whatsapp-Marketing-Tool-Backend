const express = require("express");
const { getWhatsAppClient } = require("./pair");
const Contact = require("../models/Contact");
const Category = require("../models/Category");

const router = express.Router();

// Generate and detect numbers automatically
router.post("/generate-and-detect", async (req, res) => {
    try {
        const {
            prefix = '77',
            count = 50,
            categoryName = "Auto Generated Contacts",
            businessType = "General",
            location = "Sri Lanka"
        } = req.body;

        const client = getWhatsAppClient();
        
        if (!client || !client.user) {
            return res.json({ 
                success: false, 
                error: 'WhatsApp not connected' 
            });
        }

        // Generate numbers automatically
        const generatedNumbers = generateNumberSeries(prefix, count);
        
        // Create category for auto-generated numbers
        const category = await Category.findOneAndUpdate(
            { name: categoryName },
            { 
                name: categoryName,
                description: `Auto-generated numbers with prefix ${prefix}`,
                color: '#FF6B6B',
                filters: {
                    businessType: [businessType],
                    location: [location]
                }
            },
            { upsert: true, new: true }
        );

        const results = [];
        let activeCount = 0;

        // Detect which numbers are on WhatsApp
        for (const number of generatedNumbers.slice(0, 100)) { // Limit to 100 for demo
            try {
                const formattedNumber = number + '@s.whatsapp.net';
                
                const [result] = await client.onWhatsApp(formattedNumber);
                
                if (result && result.exists) {
                    // Get profile information
                    let profileName = null;
                    try {
                        const profile = await client.profilePictureUrl(result.jid);
                        if (profile) {
                            // Try to get status
                            try {
                                const status = await client.fetchStatus(result.jid);
                                profileName = status?.status || null;
                            } catch (statusError) {
                                // Status might not be available
                            }
                        }
                    } catch (profileError) {
                        // Profile might not be available
                    }
                    
                    const contactData = {
                        phoneNumber: number,
                        name: profileName,
                        businessType: businessType,
                        location: location,
                        status: 'active',
                        source: 'auto_generated',
                        whatsappStatus: {
                            isOnWhatsApp: true,
                            lastChecked: new Date(),
                            profileName: profileName
                        },
                        categories: [category._id],
                        tags: ['auto-generated', `prefix-${prefix}`]
                    };
                    
                    // Save to contacts database
                    const contact = await Contact.findOneAndUpdate(
                        { phoneNumber: number },
                        contactData,
                        { upsert: true, new: true }
                    );
                    
                    results.push({
                        number: number,
                        status: 'active',
                        profileName: profileName,
                        contactId: contact._id
                    });
                    activeCount++;
                    
                } else {
                    results.push({
                        number: number,
                        status: 'inactive',
                        jid: null
                    });
                }
                
                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 800));
                
            } catch (error) {
                results.push({
                    number: number,
                    status: 'error',
                    error: error.message
                });
            }
        }

        // Update category contact count
        await updateCategoryContactCount(category._id);

        res.json({
            success: true,
            generated: generatedNumbers.length,
            detected: results.length,
            active: activeCount,
            inactive: results.length - activeCount,
            activePercentage: ((activeCount / results.length) * 100).toFixed(2),
            category: category,
            results: results,
            sampleNumbers: generatedNumbers.slice(0, 10) // Show first 10 generated numbers
        });

    } catch (error) {
        console.error('Auto generation error:', error);
        res.json({ 
            success: false, 
            error: 'Auto generation failed: ' + error.message 
        });
    }
});

// Generate numbers by area code
router.post("/generate-by-area", async (req, res) => {
    try {
        const {
            areaCode = '11', // Colombo area code
            count = 30,
            categoryName = "Colombo Contacts"
        } = req.body;

        // Generate landline numbers and convert to mobile pattern
        const generatedNumbers = generateLandlineBasedNumbers(areaCode, count);
        
        // Then detect WhatsApp numbers (similar to above)
        // ... detection logic here

        res.json({
            success: true,
            areaCode: areaCode,
            generatedNumbers: generatedNumbers,
            total: generatedNumbers.length
        });

    } catch (error) {
        console.error('Area-based generation error:', error);
        res.json({ 
            success: false, 
            error: 'Area-based generation failed: ' + error.message 
        });
    }
});

// Smart number generation based on existing patterns
router.post("/smart-generation", async (req, res) => {
    try {
        const {
            pattern = 'random',
            count = 100,
            categoryName = "Smart Generated Contacts"
        } = req.body;

        let generatedNumbers = [];

        if (pattern === 'random') {
            generatedNumbers = generateRandomNumbers(count);
        } else if (pattern === 'sequential') {
            generatedNumbers = generateSequentialBatch(count);
        } else if (pattern === 'mixed') {
            generatedNumbers = generateMixedNumbers(count);
        }

        // Return numbers for preview (detection can be done separately)
        res.json({
            success: true,
            pattern: pattern,
            generatedCount: generatedNumbers.length,
            numbers: generatedNumbers,
            categorySuggestion: categoryName
        });

    } catch (error) {
        console.error('Smart generation error:', error);
        res.json({ 
            success: false, 
            error: 'Smart generation failed: ' + error.message 
        });
    }
});

// Helper function to generate number series
function generateNumberSeries(prefix, count) {
    const numbers = [];
    const base = `94${prefix}`;
    
    for (let i = 0; i < count; i++) {
        // Generate random 7-digit number
        const randomSuffix = Math.floor(1000000 + Math.random() * 9000000);
        const fullNumber = base + randomSuffix;
        
        // Ensure the number is exactly 12 digits (94 + 77 + 7 digits)
        numbers.push(fullNumber.substring(0, 12));
    }
    
    return numbers;
}

// Generate random numbers with different prefixes
function generateRandomNumbers(count) {
    const prefixes = ['70', '71', '72', '74', '75', '76', '77', '78', '79'];
    const numbers = [];
    
    for (let i = 0; i < count; i++) {
        const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const randomSuffix = Math.floor(1000000 + Math.random() * 9000000);
        const number = `94${randomPrefix}${randomSuffix}`.substring(0, 12);
        numbers.push(number);
    }
    
    return numbers;
}

// Generate sequential numbers in batches
function generateSequentialBatch(count) {
    const numbers = [];
    const startBase = 94771230000; // Starting point
    
    for (let i = 0; i < count; i++) {
        numbers.push((startBase + i).toString());
    }
    
    return numbers;
}

// Generate mixed pattern numbers
function generateMixedNumbers(count) {
    const numbers = [];
    const patterns = [
        '9477xxxxxxx', '9476xxxxxxx', '9471xxxxxxx', 
        '9470xxxxxxx', '9475xxxxxxx', '9478xxxxxxx'
    ];
    
    for (let i = 0; i < count; i++) {
        const pattern = patterns[Math.floor(Math.random() * patterns.length)];
        const number = pattern.replace(/x/g, () => Math.floor(Math.random() * 10));
        numbers.push(number);
    }
    
    return numbers;
}

// Generate numbers based on landline area codes
function generateLandlineBasedNumbers(areaCode, count) {
    const numbers = [];
    
    for (let i = 0; i < count; i++) {
        // Convert landline pattern to mobile pattern
        const randomMobile = Math.floor(1000000 + Math.random() * 9000000);
        const number = `94${areaCode}${randomMobile}`.substring(0, 12);
        numbers.push(number);
    }
    
    return numbers;
}

// Helper function to update category contact count
async function updateCategoryContactCount(categoryId) {
    const category = await Category.findById(categoryId);
    if (!category) return;
    
    const contactCount = await Contact.countDocuments({ 
        categories: categoryId 
    });
    
    category.contactCount = contactCount;
    await category.save();
}

module.exports = router;
