// Chowaniec Cleaning Service Configuration
window.CLEANING_CONFIG = {
    // General Service Settings
    serviceSettings: {
        maxBedrooms: 5,
        currency: '$'
    },

    // Cleaning Packages Catalog
    // Price = basePrice + (bedrooms - 1) * perBedroom
    // Duration = baseHours + (bedrooms - 1) * perBedroomHours
    packages: [
        {
            id: 'essential-tidy',
            name: 'Essential Tidy',
            tagline: 'A fresh reset for everyday living.',
            basePrice: 89.00,
            perBedroom: 20.00,
            baseHours: 2,
            perBedroomHours: 0.5,
            icon: 'sparkles',
            includes: [
                'Dust all reachable surfaces',
                'Vacuum & mop floors',
                'Kitchen counters & sink',
                'Bathroom sanitizing',
                'Make beds & empty trash'
            ]
        },
        {
            id: 'deep-clean',
            name: 'Deep Clean',
            tagline: 'Top-to-bottom detail for every room.',
            basePrice: 169.00,
            perBedroom: 35.00,
            baseHours: 4,
            perBedroomHours: 0.75,
            icon: 'spray-can',
            includes: [
                'Everything in Essential Tidy',
                'Baseboards, doors & trim',
                'Light fixtures & ceiling fans',
                'Cabinet fronts & appliances',
                'Grout & tile scrubbing'
            ]
        },
        {
            id: 'move-in-out',
            name: 'Move-In / Move-Out',
            tagline: 'Empty-home clean, ready for keys.',
            basePrice: 249.00,
            perBedroom: 45.00,
            baseHours: 5,
            perBedroomHours: 1,
            icon: 'truck',
            includes: [
                'Everything in Deep Clean',
                'Inside all cabinets & drawers',
                'Closets & shelving wiped',
                'Wall spot cleaning',
                'Garage sweep-out'
            ]
        },
        {
            id: 'luxury-detail',
            name: 'Luxury Detail',
            tagline: 'White-glove care for the finest homes.',
            basePrice: 329.00,
            perBedroom: 55.00,
            baseHours: 6,
            perBedroomHours: 1,
            icon: 'gem',
            includes: [
                'Everything in Deep Clean',
                'Hand-polished fixtures & glass',
                'Fresh linens & hotel-style beds',
                'Organized closets & pantry',
                'Premium eco-certified products'
            ]
        }
    ],

    // Optional Add-Ons
    addOns: [
        { id: 'fridge', name: 'Inside Fridge', price: 35.00, icon: 'refrigerator' },
        { id: 'oven', name: 'Inside Oven', price: 30.00, icon: 'cooking-pot' },
        { id: 'windows', name: 'Interior Windows', price: 45.00, icon: 'app-window' },
        { id: 'laundry', name: 'Laundry Wash & Fold', price: 25.00, icon: 'shirt' }
    ],

    // Arrival Windows (startHour is used to block windows that already began today)
    arrivalWindows: [
        { id: 'morning', name: 'Morning', range: '8:00 – 10:00 AM', startHour: 8, icon: 'sunrise' },
        { id: 'midday', name: 'Midday', range: '11:00 AM – 1:00 PM', startHour: 11, icon: 'sun' },
        { id: 'afternoon', name: 'Afternoon', range: '2:00 – 4:00 PM', startHour: 14, icon: 'sunset' }
    ],

    // Visit Frequency & Recurring Discounts
    frequencies: [
        { id: 'one-time', name: 'One-Time', discount: 0 },
        { id: 'weekly', name: 'Weekly', discount: 0.15 },
        { id: 'bi-weekly', name: 'Bi-Weekly', discount: 0.10 }
    ]
};
