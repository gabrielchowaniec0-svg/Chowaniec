// Chowaniec Restaurants Configuration
window.DINING_CONFIG = {
    // Reservation Settings
    reservationSettings: {
        firstSeating: '17:00',      // 5:00 PM (24h)
        lastSeating: '21:30',       // 9:30 PM (24h)
        intervalMinutes: 30,
        maxPartySize: 8,
        unavailableRate: 0.3        // share of slots shown as fully booked
    },

    // Dietary tag legend
    dietaryTags: {
        V: 'Vegetarian',
        VG: 'Vegan',
        GF: 'Gluten Free'
    },

    // Curated Menu, grouped by course
    courses: [
        {
            id: 'starters',
            name: 'Starters',
            icon: 'salad',
            items: [
                { name: 'Heirloom Tomato Carpaccio', description: 'Basil oil, smoked sea salt, aged balsamic pearls.', price: 14.00, tags: ['V', 'VG', 'GF'] },
                { name: 'Burrata & Stone Fruit', description: 'Grilled peaches, pistachio crumble, warm honey.', price: 16.00, tags: ['V', 'GF'] },
                { name: 'Seared Scallops', description: 'Cauliflower purée, brown butter, capers.', price: 21.00, tags: ['GF'] },
                { name: 'Wild Mushroom Soup', description: 'Thyme cream, sourdough croutons.', price: 12.00, tags: ['V'] }
            ]
        },
        {
            id: 'mains',
            name: 'Mains',
            icon: 'utensils-crossed',
            items: [
                { name: 'Dry-Aged Ribeye', description: '14 oz, charred shallots, red wine jus, crispy potatoes.', price: 48.00, tags: ['GF'] },
                { name: 'Pan-Roasted Halibut', description: 'Saffron broth, fennel, mussels, grilled bread.', price: 39.00, tags: [] },
                { name: 'Handmade Pierogi', description: 'Potato and farmer\'s cheese, caramelized onion, sour cream.', price: 24.00, tags: ['V'] },
                { name: 'Charred Cauliflower Steak', description: 'Romesco, toasted almonds, salsa verde.', price: 26.00, tags: ['V', 'VG', 'GF'] }
            ]
        },
        {
            id: 'desserts',
            name: 'Desserts',
            icon: 'cake-slice',
            items: [
                { name: 'Dark Chocolate Torte', description: 'Flourless, sea salt, crème fraîche.', price: 13.00, tags: ['V', 'GF'] },
                { name: 'Vanilla Bean Panna Cotta', description: 'Macerated berries, shortbread crumb.', price: 11.00, tags: ['V'] },
                { name: 'Coconut Sorbet Trio', description: 'Mango, passion fruit, toasted coconut.', price: 10.00, tags: ['V', 'VG', 'GF'] }
            ]
        },
        {
            id: 'drinks',
            name: 'Drinks',
            icon: 'wine',
            items: [
                { name: 'House Old Fashioned', description: 'Rye, demerara, orange bitters.', price: 15.00, tags: ['V', 'VG', 'GF'] },
                { name: 'Sparkling Elderflower', description: 'Zero-proof, cucumber, lime, tonic.', price: 9.00, tags: ['V', 'VG', 'GF'] },
                { name: 'Sommelier\'s Red Pour', description: 'Rotating selection by the glass.', price: 16.00, tags: ['V', 'VG', 'GF'] },
                { name: 'Espresso', description: 'Single-origin, served with a biscotti.', price: 5.00, tags: ['V'] }
            ]
        }
    ]
};
