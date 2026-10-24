// Doodle Guess word list: kid-friendly things to draw, in three levels.
// Easy: simple objects a five-year-old can draw. Medium: animals, people and places with a few details.
// Hard: scenes, actions and ideas. The drawer picks one of three (one from each level) every turn.
window.DOODLE_WORDS = {
  easy: [
    'apple', 'ball', 'banana', 'bed', 'bee', 'bell', 'bird', 'boat', 'book', 'bus',
    'cake', 'car', 'carrot', 'cat', 'chair', 'cheese', 'cloud', 'cookie', 'cow', 'crab',
    'crown', 'cup', 'dog', 'door', 'duck', 'ear', 'egg', 'eye', 'fish', 'flag',
    'flower', 'foot', 'fork', 'frog', 'gift', 'glasses', 'grapes', 'hand', 'hat', 'heart',
    'house', 'ice cream', 'key', 'kite', 'ladder', 'lamp', 'leaf', 'lemon', 'lollipop', 'moon',
    'mouse', 'mushroom', 'nose', 'orange', 'owl', 'pear', 'pencil', 'pig', 'pizza', 'rainbow',
    'ring', 'robot', 'rocket', 'shoe', 'smile', 'snail', 'snake', 'snowman', 'sock', 'spoon',
    'star', 'sun', 'table', 'teddy bear', 'tent', 'tree', 'train', 'truck', 'umbrella', 'worm',
    'window', 'balloon', 'bone', 'bowl', 'box', 'bucket', 'candle', 'clock', 'cupcake', 'dice',
    'donut', 'drum', 'feather', 'fire', 'hammer', 'juice', 'nest', 'pants', 'pie', 'plane',
    'potato', 'pumpkin', 'rabbit', 'sheep', 'ship', 'strawberry', 'sunflower', 'swing', 'shirt', 'tomato',
    'tooth', 'turtle', 'watermelon', 'whale', 'wheel', 'cherry', 'corn', 'bear', 'bow', 'bubble',
    'butterfly', 'cactus', 'chicken', 'crayon', 'envelope', 'glove', 'guitar', 'hamburger', 'igloo', 'ladybug',
    'lips', 'mitten', 'monkey', 'panda', 'peach', 'pineapple', 'puppy', 'rain', 'scarf', 'slide',
    'snowflake', 'bat', 'bread', 'broccoli', 'bridge', 'brush', 'button', 'skirt', 'spider', 'comb',
    'cone', 'muffin', 'elephant', 'fence', 'flower pot', 'giraffe', 'grass', 'hot dog', 'jelly', 'lion'
  ],
  medium: [
    'astronaut', 'backpack', 'bandage', 'barn', 'beach', 'bicycle', 'blanket', 'broom', 'campfire', 'camera',
    'candy cane', 'castle', 'caterpillar', 'cereal', 'chimney', 'circus', 'computer', 'cowboy', 'crocodile', 'desert',
    'dinosaur', 'dolphin', 'dragon', 'elevator', 'fairy', 'farmer', 'firefighter', 'fireworks', 'fishing', 'flamingo',
    'fountain', 'garden', 'hairbrush', 'hedgehog', 'helicopter', 'hippo', 'honey', 'island', 'jellyfish', 'kangaroo',
    'king', 'knight', 'koala', 'lighthouse', 'lizard', 'magnet', 'map', 'mermaid', 'microphone', 'motorcycle',
    'mountain', 'ocean', 'paintbrush', 'palm tree', 'parachute', 'peacock', 'picnic', 'pirate', 'playground', 'popcorn',
    'princess', 'puddle', 'queen', 'raincoat', 'sailboat', 'sandcastle', 'scarecrow', 'scissors', 'seahorse', 'shark',
    'skateboard', 'sled', 'snowball', 'spaceship', 'squirrel', 'stairs', 'submarine', 'superhero', 'swimming pool', 'telescope',
    'tiger', 'toothbrush', 'tractor', 'treasure', 'unicorn', 'volcano', 'waterfall', 'wizard', 'zebra', 'zoo',
    'alien', 'basket', 'beard', 'beehive', 'bowling', 'chef', 'compass', 'dentist', 'doctor', 'ferris wheel',
    'gingerbread man', 'globe', 'gorilla', 'hamster', 'headphones', 'hot air balloon', 'ice skates', 'jungle', 'lawn mower', 'mailbox',
    'medal', 'milkshake', 'moose', 'notebook', 'ostrich', 'pancake', 'penguin', 'piano', 'pillow', 'pinwheel',
    'polar bear', 'pond', 'puppet', 'rake', 'reindeer', 'river', 'roof', 'sandwich', 'scooter', 'shadow',
    'seashell', 'skunk', 'sofa', 'sponge', 'starfish', 'suitcase', 'sunglasses', 'swan', 'taco', 'teapot',
    'toaster', 'toucan', 'trophy', 'trumpet', 'tulip', 'violin', 'walrus', 'magic wand', 'waffle', 'windmill',
    'yo-yo', 'raccoon', 'octopus', 'parrot', 'necklace', 'treasure chest', 'fire truck', 'police car', 'school bus', 'snowboard'
  ],
  hard: [
    'acrobat', 'airport', 'ambulance', 'aquarium', 'bakery', 'ballerina', 'bamboo', 'barbecue', 'birthday party', 'blizzard',
    'brain', 'bubble bath', 'bulldozer', 'bunk bed', 'camping', 'carousel', 'chess', 'chopsticks', 'constellation', 'construction site',
    'cuckoo clock', 'daydream', 'dishwasher', 'dizzy', 'dream', 'echo', 'eclipse', 'electricity', 'escalator', 'family',
    'fireplace', 'flashlight', 'friendship', 'gravity', 'greenhouse', 'haircut', 'hammock', 'hibernation', 'high five', 'hiccups',
    'hide and seek', 'homework', 'hopscotch', 'hula hoop', 'jigsaw', 'juggling', 'laundry', 'lemonade stand', 'marathon', 'maze',
    'message in a bottle', 'museum', 'music box', 'nap', 'north pole', 'orchestra', 'origami', 'pajamas', 'parade', 'passport',
    'photograph', 'pillow fight', 'planet', 'postcard', 'rainstorm', 'recycling', 'referee', 'roller skates', 'rollercoaster', 'safari',
    'scuba diving', 'seesaw', 'shooting star', 'sleepover', 'snore', 'solar system', 'spaghetti', 'sunburn', 'sunrise', 'supermarket',
    'surfing', 'tightrope', 'time machine', 'toothpaste', 'traffic jam', 'trampoline', 'treasure map', 'tug of war', 'tunnel', 'vacation',
    'video game', 'waiter', 'wedding', 'wheelbarrow', 'wind', 'wink', 'x-ray', 'zipper', 'waterslide', 'snow globe',
    'magician', 'jack in the box', 'mirror', 'gingerbread house', 'piggy bank', 'picnic basket', 'sneeze', 'spotlight', 'statue', 'tooth fairy',
    'treehouse', 'whisper', 'yoga', 'cotton candy', 'dance party', 'ice hockey', 'marshmallow', 'merry-go-round', 'paper plane', 'pogo stick',
    'puppet show', 'rubber duck', 'hourglass', 'skyscraper', 'soap bubbles', 'space station', 'stargazing', 'sundae', 'thunderstorm', 'tow truck',
    'train station', 'washing machine', 'wishing well', 'butterfly net', 'kite flying', 'snow angel', 'sandbox', 'bird feeder', 'garden gnome', 'family photo',
    'grandparents', 'tea party', 'library', 'lunch box', 'alarm clock', 'birthday candles', 'swimming', 'tennis', 'football', 'basketball',
    'skiing', 'singing', 'painting', 'reading', 'sleeping', 'cooking', 'laughing', 'running', 'climbing', 'dancing'
  ]
};
