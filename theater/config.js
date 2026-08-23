// Chowaniec Premiere Theaters Configuration
window.THEATER_CONFIG = {
    // Auditorium & Seating Settings
    theaterSettings: {
        baseSeatPrice: 18.00,
        rows: ['A', 'B', 'C', 'D'],
        seatColumnsCount: 8
    },

    // Movie Screenings Catalog
    featureFilms: [
        {
            id: 'episode-1',
            title: 'Episode 1: Cousin Hangout',
            runtime: '9 MIN',
            genre: 'Drama',
            rating: 'PG',
            priceMultiplier: 1.0,
            times: ['2:15 PM', '5:30 PM', '8:45 PM'],
            synopsis: 'The cousins meet together to hang out, finding the experience to be quite awkward.',
            icon: 'disc'
        },
        {
            id: 'episode-2',
            title: 'Episode 2: Sleepover',
            runtime: '10 MIN',
            genre: 'Drama',
            rating: 'PG',
            priceMultiplier: 1.0,
            times: ['4:00 PM', '7:15 PM', '9:50 PM'],
            synopsis: 'The cousins meet for a sleepover, where they enjoy a meal together and have fun.',
            icon: 'moon'
        }
    ],

    // Artisan Concessions
    concessions: [
        { id: 'popcorn', name: 'Popcorn', price: 9.00 },
        { id: 'gummy-bears', name: 'Gummy Bears', price: 6.00 },
        { id: 'water', name: 'Water', price: 4.00 },
        { id: 'slushie', name: 'Slushie', price: 6.00 }
    ]
};
