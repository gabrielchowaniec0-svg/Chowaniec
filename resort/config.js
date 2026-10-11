// Chowaniec Hotels & Resorts Configuration
window.RESORT_CONFIG = {
    // Property Settings
    resortSettings: {
        propertyName: 'Chowaniec Hotels & Resorts',
        checkInTime: '3:00 PM',
        checkOutTime: '11:00 AM',
        maxNights: 30
    },

    // Room & Suite Catalog
    roomTypes: [
        {
            id: 'garden-suite',
            name: 'Garden Suite',
            category: 'Suite',
            nightlyPrice: 240.00,
            capacity: 2,
            size: '480 SQ FT',
            bed: '1 Queen',
            description: 'A quiet ground-floor retreat opening onto a private terrace and the botanical courtyard.',
            amenities: ['Private Terrace', 'Rain Shower', 'Espresso Bar', 'Wi-Fi'],
            icon: 'trees'
        },
        {
            id: 'ocean-view-king',
            name: 'Ocean View King',
            category: 'Deluxe Room',
            nightlyPrice: 320.00,
            capacity: 3,
            size: '520 SQ FT',
            bed: '1 King',
            description: 'Floor-to-ceiling windows frame the coastline, with a soaking tub positioned for sunset.',
            amenities: ['Ocean View', 'Soaking Tub', 'Balcony', 'Wi-Fi'],
            icon: 'waves'
        },
        {
            id: 'family-villa',
            name: 'Family Villa',
            category: 'Villa',
            nightlyPrice: 480.00,
            capacity: 6,
            size: '1,200 SQ FT',
            bed: '2 Queens + Bunks',
            description: 'A two-bedroom standalone villa with a full kitchen, lounge, and room for the whole family.',
            amenities: ['Two Bedrooms', 'Full Kitchen', 'Plunge Pool', 'Wi-Fi'],
            icon: 'house'
        },
        {
            id: 'penthouse',
            name: 'Penthouse',
            category: 'Signature Suite',
            nightlyPrice: 950.00,
            capacity: 4,
            size: '2,100 SQ FT',
            bed: '2 Kings',
            description: 'The top floor in its entirety: wraparound terrace, private dining room, and butler service.',
            amenities: ['Wraparound Terrace', 'Butler Service', 'Private Dining', 'Wi-Fi'],
            icon: 'building-2'
        }
    ]
};
