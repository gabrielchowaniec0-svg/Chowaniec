// Chowaniec Spa Configuration
window.SPA_CONFIG = {
    // Hours & Scheduling Settings
    spaSettings: {
        openHour: 9,          // first appointment 9:00 AM
        lastStartHour: 18,    // last appointment 6:00 PM
        slotMinutes: 30,
        unavailableRate: 0.3  // ~30% of slots are pre-booked
    },

    // Service Categories (used for filter chips)
    categories: [
        { id: 'massage', name: 'Massage', icon: 'hand-heart' },
        { id: 'facials', name: 'Facials', icon: 'sparkles' },
        { id: 'body', name: 'Body', icon: 'waves' },
        { id: 'nails', name: 'Nails', icon: 'palette' }
    ],

    // Spa Services Catalog
    services: [
        {
            id: 'swedish-relaxation',
            category: 'massage',
            name: 'Swedish Relaxation',
            duration: 60,
            price: 110.00,
            description: 'Long, flowing strokes that melt away tension and calm the mind.',
            icon: 'hand-heart'
        },
        {
            id: 'deep-tissue',
            category: 'massage',
            name: 'Deep Tissue Massage',
            duration: 75,
            price: 135.00,
            description: 'Focused pressure that releases chronic knots in muscles and fascia.',
            icon: 'hand'
        },
        {
            id: 'hot-stone',
            category: 'massage',
            name: 'Hot Stone Ritual',
            duration: 90,
            price: 165.00,
            description: 'Warm basalt stones paired with aromatic oils for total relaxation.',
            icon: 'flower-2'
        },
        {
            id: 'signature-hydrating',
            category: 'facials',
            name: 'Signature Hydrating Facial',
            duration: 60,
            price: 120.00,
            description: 'Cleanse, exfoliate and deeply hydrate for a fresh, dewy complexion.',
            icon: 'droplets'
        },
        {
            id: 'gold-radiance',
            category: 'facials',
            name: 'Gold Radiance Facial',
            duration: 75,
            price: 155.00,
            description: 'A luminous 24k gold-infused treatment that brightens and firms.',
            icon: 'gem'
        },
        {
            id: 'express-glow',
            category: 'facials',
            name: 'Express Glow',
            duration: 30,
            price: 65.00,
            description: 'A quick refresh with enzyme peel and soothing mask.',
            icon: 'sparkles'
        },
        {
            id: 'sea-salt-scrub',
            category: 'body',
            name: 'Sea Salt Body Scrub',
            duration: 45,
            price: 95.00,
            description: 'Mineral-rich sea salt polish followed by a warm shower and body butter.',
            icon: 'waves'
        },
        {
            id: 'seaweed-wrap',
            category: 'body',
            name: 'Detox Seaweed Wrap',
            duration: 60,
            price: 125.00,
            description: 'A cocooning marine wrap that detoxifies and softens the skin.',
            icon: 'leaf'
        },
        {
            id: 'classic-manicure',
            category: 'nails',
            name: 'Classic Manicure',
            duration: 30,
            price: 40.00,
            description: 'Shape, cuticle care, hand massage and polish of your choice.',
            icon: 'palette'
        },
        {
            id: 'gel-manicure',
            category: 'nails',
            name: 'Gel Manicure',
            duration: 45,
            price: 55.00,
            description: 'Long-lasting, chip-resistant gel color with a glossy finish.',
            icon: 'brush'
        },
        {
            id: 'spa-pedicure',
            category: 'nails',
            name: 'Spa Pedicure',
            duration: 45,
            price: 60.00,
            description: 'Warm soak, exfoliation, massage and polish for tired feet.',
            icon: 'bath'
        }
    ],

    // Therapists & Their Specialties
    therapists: [
        { id: 'elena', name: 'Elena', title: 'Senior Massage Therapist', specialties: ['massage', 'body'] },
        { id: 'marco', name: 'Marco', title: 'Sports & Deep Tissue', specialties: ['massage'] },
        { id: 'sofia', name: 'Sofia', title: 'Lead Esthetician', specialties: ['facials', 'body'] },
        { id: 'aria', name: 'Aria', title: 'Nail Artist & Esthetician', specialties: ['nails', 'facials'] },
        { id: 'jonah', name: 'Jonah', title: 'Body Treatment Specialist', specialties: ['body', 'massage'] }
    ]
};
