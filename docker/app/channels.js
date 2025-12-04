// DirecTV Channel Definitions
// Complete lineup of 300+ channels with channel numbers
// searchTerms field allows matching against different variations of channel names in the guide

const channels = [
  // ================== NEWS ==================
  { id: 'cnn', name: 'CNN', number: '202', category: 'News' },
  { id: 'hln', name: 'HLN', number: '204', category: 'News' },
  { id: 'cnbc', name: 'CNBC', number: '355', category: 'News' },
  { id: 'msnbc', name: 'MSNBC', number: '356', category: 'News' },
  { id: 'cnbc-world', name: 'CNBC World', number: '357', category: 'News' },
  { id: 'cnni', name: 'CNN International', number: '358', category: 'News', searchTerms: ['CNNi'] },
  { id: 'fox-business', name: 'FOX Business Network', number: '359', category: 'News', searchTerms: ['Fox Business', 'FBN'] },
  { id: 'fox-news', name: 'FOX News Channel', number: '360', category: 'News', searchTerms: ['Fox News', 'FNC'] },
  { id: 'accuweather', name: 'AccuWeather', number: '361', category: 'News' },
  { id: 'weather-channel', name: 'Weather Channel', number: '362', category: 'News', searchTerms: ['The Weather Channel', 'TWC'] },
  { id: 'fox-weather', name: 'FOX Weather', number: '363', category: 'News' },
  { id: 'newsmax', name: 'Newsmax', number: '349', category: 'News' },
  { id: 'newsnation', name: 'NewsNation', number: '307', category: 'News' },
  { id: 'bbc-news', name: 'BBC News', number: '346', category: 'News', searchTerms: ['BBC World News'] },
  { id: 'bloomberg', name: 'Bloomberg TV', number: '353', category: 'News' },
  { id: 'cheddar', name: 'Cheddar News', number: '354', category: 'News' },
  { id: 'cspan', name: 'C-SPAN', number: '350', category: 'News' },
  { id: 'cspan2', name: 'C-SPAN2', number: '351', category: 'News' },
  { id: 'i24-news', name: 'i24 News', number: '343', category: 'News' },
  { id: 'the-first', name: 'The First', number: '347', category: 'News' },
  { id: 'free-speech', name: 'Free Speech TV', number: '348', category: 'News' },

  // ================== SPORTS ==================
  { id: 'espn', name: 'ESPN', number: '206', category: 'Sports' },
  { id: 'espn2', name: 'ESPN2', number: '209', category: 'Sports' },
  { id: 'espnu', name: 'ESPNU', number: '208', category: 'Sports' },
  { id: 'espnews', name: 'ESPNews', number: '207', category: 'Sports' },
  { id: 'espn-deportes', name: 'ESPN Deportes', number: '466', category: 'Sports' },
  { id: 'fs1', name: 'FS1', number: '219', category: 'Sports', searchTerms: ['FOX Sports 1', 'Fox Sports 1'] },
  { id: 'fs2', name: 'FS2', number: '618', category: 'Sports', searchTerms: ['FOX Sports 2', 'Fox Sports 2'] },
  { id: 'fox-deportes', name: 'FOX Deportes', number: '465', category: 'Sports' },
  { id: 'nfl-network', name: 'NFL Network', number: '212', category: 'Sports' },
  { id: 'mlb-network', name: 'MLB Network', number: '213', category: 'Sports' },
  { id: 'nba-tv', name: 'NBA TV', number: '216', category: 'Sports' },
  { id: 'nhl-network', name: 'NHL Network', number: '215', category: 'Sports' },
  { id: 'golf', name: 'Golf Channel', number: '218', category: 'Sports' },
  { id: 'tennis', name: 'Tennis Channel', number: '217', category: 'Sports' },
  { id: 'cbs-sports', name: 'CBS Sports Network', number: '221', category: 'Sports', searchTerms: ['CBSSN'] },
  { id: 'big-ten', name: 'Big Ten Network', number: '610', category: 'Sports', searchTerms: ['BTN'] },
  { id: 'sec-network', name: 'SEC Network', number: '611', category: 'Sports' },
  { id: 'acc-network', name: 'ACC Network', number: '612', category: 'Sports' },
  { id: 'olympic-channel', name: 'Olympic Channel', number: '624', category: 'Sports' },
  { id: 'fanduel', name: 'FanDuel TV', number: '602', category: 'Sports' },
  { id: 'cowboy-channel', name: 'Cowboy Channel', number: '603', category: 'Sports' },
  { id: 'pursuit', name: 'Pursuit', number: '604', category: 'Sports' },
  { id: 'sportsman', name: 'Sportsman Channel', number: '605', category: 'Sports' },
  { id: 'outdoor', name: 'Outdoor Channel', number: '606', category: 'Sports' },
  { id: 'motortrend', name: 'MotorTrend', number: '281', category: 'Sports' },
  { id: 'longhorn', name: 'Longhorn Network', number: '677', category: 'Sports' },
  { id: 'tudn', name: 'TUDN', number: '464', category: 'Sports' },
  { id: 'goltv', name: 'GolTV', number: '468', category: 'Sports' },
  { id: 'tyc-sports', name: 'TyC Sports', number: '469', category: 'Sports' },

  // Regional Sports Networks
  { id: 'nesn', name: 'NESN', number: '628', category: 'Sports' },
  { id: 'nbc-sports-boston', name: 'NBC Sports Boston', number: '630', category: 'Sports' },
  { id: 'yes', name: 'YES Network', number: '631', category: 'Sports' },
  { id: 'msg', name: 'MSG', number: '634', category: 'Sports' },
  { id: 'msg-sportsnet', name: 'MSG Sportsnet', number: '635', category: 'Sports' },
  { id: 'sny', name: 'SNY', number: '639', category: 'Sports' },
  { id: 'masn', name: 'MASN', number: '640', category: 'Sports' },
  { id: 'nbc-sports-washington', name: 'NBC Sports Washington', number: '642', category: 'Sports' },
  { id: 'bally-sports-south', name: 'Bally Sports South', number: '646', category: 'Sports' },
  { id: 'bally-sports-southeast', name: 'Bally Sports Southeast', number: '649', category: 'Sports' },
  { id: 'bally-sports-sun', name: 'Bally Sports Sun', number: '653', category: 'Sports' },
  { id: 'bally-sports-florida', name: 'Bally Sports Florida', number: '654', category: 'Sports' },
  { id: 'att-sportsnet-pittsburgh', name: 'AT&T SportsNet Pittsburgh', number: '659', category: 'Sports' },
  { id: 'bally-sports-ohio', name: 'Bally Sports Ohio', number: '660', category: 'Sports' },
  { id: 'bally-sports-cincinnati', name: 'Bally Sports Cincinnati', number: '661', category: 'Sports' },
  { id: 'bally-sports-great-lakes', name: 'Bally Sports Great Lakes', number: '662', category: 'Sports' },
  { id: 'bally-sports-detroit', name: 'Bally Sports Detroit', number: '663', category: 'Sports' },
  { id: 'marquee', name: 'Marquee Sports Network', number: '664', category: 'Sports' },
  { id: 'nbc-sports-chicago', name: 'NBC Sports Chicago', number: '665', category: 'Sports' },
  { id: 'bally-sports-north', name: 'Bally Sports North', number: '668', category: 'Sports' },
  { id: 'bally-sports-wisconsin', name: 'Bally Sports Wisconsin', number: '669', category: 'Sports' },
  { id: 'bally-sports-indiana', name: 'Bally Sports Indiana', number: '671', category: 'Sports' },
  { id: 'att-sportsnet-southwest', name: 'AT&T SportsNet Southwest', number: '674', category: 'Sports' },
  { id: 'bally-sports-oklahoma', name: 'Bally Sports Oklahoma', number: '675', category: 'Sports' },
  { id: 'bally-sports-new-orleans', name: 'Bally Sports New Orleans', number: '676', category: 'Sports' },
  { id: 'altitude', name: 'Altitude Sports', number: '681', category: 'Sports' },
  { id: 'att-sportsnet-rocky-mountain', name: 'AT&T SportsNet Rocky Mountain', number: '683', category: 'Sports' },
  { id: 'bally-sports-arizona', name: 'Bally Sports Arizona', number: '686', category: 'Sports' },
  { id: 'root-sports-nw', name: 'ROOT SPORTS Northwest', number: '687', category: 'Sports' },
  { id: 'spectrum-sportsnet-la', name: 'Spectrum SportsNet LA', number: '690', category: 'Sports' },
  { id: 'spectrum-sportsnet', name: 'Spectrum SportsNet', number: '691', category: 'Sports' },
  { id: 'bally-sports-west', name: 'Bally Sports West', number: '692', category: 'Sports' },
  { id: 'bally-sports-socal', name: 'Bally Sports SoCal', number: '693', category: 'Sports' },
  { id: 'bally-sports-san-diego', name: 'Bally Sports San Diego', number: '694', category: 'Sports' },
  { id: 'nbc-sports-bay-area', name: 'NBC Sports Bay Area', number: '696', category: 'Sports' },
  { id: 'nbc-sports-california', name: 'NBC Sports California', number: '698', category: 'Sports' },

  // ================== ENTERTAINMENT ==================
  { id: 'usa', name: 'USA Network', number: '242', category: 'Entertainment' },
  { id: 'tnt', name: 'TNT', number: '245', category: 'Entertainment' },
  { id: 'tbs', name: 'TBS', number: '247', category: 'Entertainment' },
  { id: 'trutv', name: 'truTV', number: '246', category: 'Entertainment' },
  { id: 'fx', name: 'FX', number: '248', category: 'Entertainment' },
  { id: 'fxx', name: 'FXX', number: '259', category: 'Entertainment' },
  { id: 'fx-movie', name: 'FX Movie Channel', number: '258', category: 'Entertainment' },
  { id: 'amc', name: 'AMC', number: '254', category: 'Entertainment' },
  { id: 'ifc', name: 'IFC', number: '333', category: 'Entertainment' },
  { id: 'sundancetv', name: 'SundanceTV', number: '239', category: 'Entertainment' },
  { id: 'bravo', name: 'Bravo', number: '237', category: 'Entertainment' },
  { id: 'e', name: 'E!', number: '236', category: 'Entertainment' },
  { id: 'comedy-central', name: 'Comedy Central', number: '249', category: 'Entertainment' },
  { id: 'mtv', name: 'MTV', number: '331', category: 'Entertainment' },
  { id: 'mtv2', name: 'MTV2', number: '332', category: 'Entertainment' },
  { id: 'mtv-classic', name: 'MTV Classic', number: '336', category: 'Entertainment' },
  { id: 'mtv-live', name: 'MTV Live', number: '572', category: 'Entertainment' },
  { id: 'vh1', name: 'VH1', number: '335', category: 'Entertainment' },
  { id: 'bet', name: 'BET', number: '329', category: 'Entertainment' },
  { id: 'bet-her', name: 'BET Her', number: '330', category: 'Entertainment' },
  { id: 'syfy', name: 'Syfy', number: '244', category: 'Entertainment' },
  { id: 'paramount', name: 'Paramount Network', number: '241', category: 'Entertainment' },
  { id: 'a-and-e', name: 'A&E', number: '265', category: 'Entertainment' },
  { id: 'fyi', name: 'fyi,', number: '266', category: 'Entertainment' },
  { id: 'lifetime', name: 'Lifetime', number: '252', category: 'Entertainment' },
  { id: 'lmn', name: 'LMN', number: '253', category: 'Entertainment', searchTerms: ['Lifetime Movie Network'] },
  { id: 'we-tv', name: 'WE tv', number: '260', category: 'Entertainment' },
  { id: 'oxygen', name: 'Oxygen True Crime', number: '251', category: 'Entertainment', searchTerms: ['Oxygen'] },
  { id: 'bbc-america', name: 'BBC America', number: '264', category: 'Entertainment' },
  { id: 'cmt', name: 'CMT', number: '327', category: 'Entertainment' },
  { id: 'tv-land', name: 'TV Land', number: '304', category: 'Entertainment' },
  { id: 'pop', name: 'POP', number: '273', category: 'Entertainment' },
  { id: 'axs', name: 'AXS TV', number: '340', category: 'Entertainment' },
  { id: 'fuse', name: 'Fuse', number: '339', category: 'Entertainment' },
  { id: 'revolt', name: 'Revolt', number: '384', category: 'Entertainment' },
  { id: 'reelz', name: 'Reelz', number: '238', category: 'Entertainment' },
  { id: 'gsn', name: 'Game Show Network', number: '233', category: 'Entertainment', searchTerms: ['GSN'] },
  { id: 'logo', name: 'Logo HD', number: '272', category: 'Entertainment', searchTerms: ['Logo'] },
  { id: 'ovation', name: 'Ovation', number: '274', category: 'Entertainment' },
  { id: 'freeform', name: 'Freeform', number: '311', category: 'Entertainment' },
  { id: 'ion', name: 'ION Television', number: '305', category: 'Entertainment', searchTerms: ['ION'] },
  { id: 'ion-west', name: 'ION Television West', number: '306', category: 'Entertainment' },
  { id: 'uptv', name: 'UPTV', number: '338', category: 'Entertainment' },
  { id: 'tv-one', name: 'TV One', number: '328', category: 'Entertainment' },
  { id: 'aspire', name: 'Aspire', number: '381', category: 'Entertainment' },
  { id: 'cleo-tv', name: 'CleoTV', number: '341', category: 'Entertainment' },
  { id: 'thegrio', name: 'TheGrio', number: '342', category: 'Entertainment' },
  { id: 'bounce', name: 'BOUNCE TV', number: '82', category: 'Entertainment' },
  { id: 'grit', name: 'GRIT', number: '81', category: 'Entertainment' },
  { id: 'metv', name: 'MeTV', number: '77', category: 'Entertainment' },
  { id: 'cozi', name: 'Cozi TV', number: '80', category: 'Entertainment' },
  { id: 'get-tv', name: 'getTV', number: '83', category: 'Entertainment', searchTerms: ['GET'] },
  { id: 'heroes-icons', name: 'Heroes & Icons', number: '385', category: 'Entertainment' },
  { id: 'comedy-tv', name: 'Comedy TV', number: '382', category: 'Entertainment' },
  { id: 'justice-central', name: 'Justice Central', number: '383', category: 'Entertainment' },

  // ================== MOVIES ==================
  { id: 'tcm', name: 'TCM', number: '256', category: 'Movies', searchTerms: ['Turner Classic Movies'] },
  { id: 'hdnet-movies', name: 'HDNet Movies', number: '566', category: 'Movies' },
  { id: 'mgm-hd', name: 'MGM HD', number: '567', category: 'Movies' },
  { id: 'sony-movies', name: 'Sony Movies', number: '568', category: 'Movies' },
  { id: 'family-movie', name: 'Family Movie Classics', number: '314', category: 'Movies' },
  { id: 'shortstv', name: 'ShortsTV', number: '573', category: 'Movies' },

  // HBO
  { id: 'hbo', name: 'HBO', number: '501', category: 'Premium', searchTerms: ['HBO East'] },
  { id: 'hbo2', name: 'HBO2', number: '502', category: 'Premium', searchTerms: ['HBO2 East'] },
  { id: 'hbo-signature', name: 'HBO Signature', number: '503', category: 'Premium' },
  { id: 'hbo-west', name: 'HBO West', number: '504', category: 'Premium' },
  { id: 'hbo2-west', name: 'HBO2 West', number: '505', category: 'Premium' },
  { id: 'hbo-comedy', name: 'HBO Comedy', number: '506', category: 'Premium' },
  { id: 'hbo-family', name: 'HBO Family', number: '507', category: 'Premium' },
  { id: 'hbo-family-west', name: 'HBO Family West', number: '508', category: 'Premium' },
  { id: 'hbo-zone', name: 'HBO Zone', number: '509', category: 'Premium' },
  { id: 'hbo-latino', name: 'HBO Latino', number: '511', category: 'Premium' },

  // Cinemax
  { id: 'cinemax', name: 'Cinemax', number: '515', category: 'Premium', searchTerms: ['Cinemax East'] },
  { id: 'cinemax-west', name: 'Cinemax West', number: '516', category: 'Premium' },
  { id: 'moremax', name: 'MoreMax', number: '517', category: 'Premium' },
  { id: 'actionmax', name: 'ActionMAX', number: '519', category: 'Premium' },
  { id: '5starmax', name: '5StarMax', number: '520', category: 'Premium' },
  { id: 'moviemax', name: 'MovieMax', number: '521', category: 'Premium' },
  { id: 'thrillermax', name: 'ThrillerMax', number: '522', category: 'Premium' },
  { id: 'cinemaxla', name: 'Cinemáx', number: '523', category: 'Premium' },

  // Starz
  { id: 'starz', name: 'STARZ', number: '525', category: 'Premium' },
  { id: 'starz-west', name: 'STARZ West', number: '526', category: 'Premium' },
  { id: 'starz-kids', name: 'STARZ Kids & Family', number: '527', category: 'Premium' },
  { id: 'starz-comedy', name: 'STARZ Comedy', number: '528', category: 'Premium' },
  { id: 'starz-edge', name: 'STARZ Edge', number: '529', category: 'Premium' },
  { id: 'starz-black', name: 'STARZ in Black', number: '530', category: 'Premium' },
  { id: 'starz-cinema', name: 'STARZ Cinema', number: '531', category: 'Premium' },
  { id: 'starz-encore', name: 'STARZ ENCORE', number: '535', category: 'Premium' },
  { id: 'starz-encore-west', name: 'STARZ ENCORE West', number: '536', category: 'Premium' },
  { id: 'starz-encore-classic', name: 'STARZ ENCORE Classic', number: '537', category: 'Premium' },
  { id: 'starz-encore-westerns', name: 'STARZ ENCORE Westerns', number: '538', category: 'Premium' },
  { id: 'starz-encore-suspense', name: 'STARZ ENCORE Suspense', number: '539', category: 'Premium' },
  { id: 'starz-encore-black', name: 'STARZ ENCORE Black', number: '540', category: 'Premium' },
  { id: 'starz-encore-action', name: 'STARZ ENCORE Action', number: '541', category: 'Premium' },
  { id: 'starz-encore-family', name: 'STARZ ENCORE Family', number: '542', category: 'Premium' },
  { id: 'starz-encore-espanol', name: 'STARZ ENCORE En Español', number: '426', category: 'Premium' },

  // Showtime
  { id: 'showtime', name: 'SHOWTIME', number: '545', category: 'Premium', searchTerms: ['Showtime East'] },
  { id: 'showtime-west', name: 'SHOWTIME West', number: '546', category: 'Premium' },
  { id: 'showtime-2', name: 'SHOWTIME 2', number: '547', category: 'Premium' },
  { id: 'sho-bet', name: 'SHO x BET', number: '548', category: 'Premium' },
  { id: 'showtime-extreme', name: 'SHOWTIME EXTREME', number: '549', category: 'Premium' },
  { id: 'showtime-showcase', name: 'SHOWTIME Showcase', number: '550', category: 'Premium' },
  { id: 'showtime-next', name: 'SHOWTIME Next', number: '551', category: 'Premium' },
  { id: 'showtime-family', name: 'SHOWTIME Family Zone', number: '552', category: 'Premium' },
  { id: 'tmc', name: 'THE MOVIE CHANNEL', number: '553', category: 'Premium', searchTerms: ['TMC East'] },
  { id: 'tmc-west', name: 'THE MOVIE CHANNEL WEST', number: '554', category: 'Premium' },
  { id: 'tmc-xtra', name: 'THE MOVIE CHANNEL XTRA', number: '555', category: 'Premium' },
  { id: 'flix', name: 'FLIX', number: '556', category: 'Premium' },

  // ================== DOCUMENTARY ==================
  { id: 'discovery', name: 'Discovery', number: '278', category: 'Documentary' },
  { id: 'history', name: 'HISTORY', number: '269', category: 'Documentary', searchTerms: ['The HISTORY Channel', 'History Channel'] },
  { id: 'natgeo', name: 'National Geographic', number: '276', category: 'Documentary', searchTerms: ['National Geographic Channel', 'Nat Geo'] },
  { id: 'natgeo-wild', name: 'Nat Geo WILD', number: '283', category: 'Documentary' },
  { id: 'animal-planet', name: 'Animal Planet', number: '282', category: 'Documentary' },
  { id: 'tlc', name: 'TLC', number: '280', category: 'Documentary' },
  { id: 'science', name: 'Science', number: '284', category: 'Documentary', searchTerms: ['Science Channel'] },
  { id: 'investigation-discovery', name: 'Investigation Discovery', number: '285', category: 'Documentary', searchTerms: ['ID'] },
  { id: 'destination-america', name: 'Destination America', number: '286', category: 'Documentary' },
  { id: 'ahc', name: 'American Heroes Channel', number: '287', category: 'Documentary' },
  { id: 'discovery-life', name: 'Discovery Life', number: '261', category: 'Documentary' },
  { id: 'discovery-family', name: 'Discovery Family Channel', number: '294', category: 'Documentary' },
  { id: 'smithsonian', name: 'Smithsonian Channel', number: '570', category: 'Documentary' },
  { id: 'crime-investigation', name: 'Crime & Investigation', number: '571', category: 'Documentary' },
  { id: 'vice', name: 'VICE', number: '271', category: 'Documentary' },
  { id: 'earthxtv', name: 'EarthxTV', number: '267', category: 'Documentary' },
  { id: 'nasa', name: 'NASA TV', number: '352', category: 'Documentary' },

  // ================== LIFESTYLE ==================
  { id: 'hgtv', name: 'HGTV', number: '229', category: 'Lifestyle' },
  { id: 'food-network', name: 'Food Network', number: '231', category: 'Lifestyle' },
  { id: 'cooking-channel', name: 'Cooking Channel', number: '232', category: 'Lifestyle' },
  { id: 'travel', name: 'Travel Channel', number: '277', category: 'Lifestyle' },
  { id: 'own', name: 'OWN', number: '279', category: 'Lifestyle', searchTerms: ['Oprah Winfrey Network'] },
  { id: 'magnolia', name: 'Magnolia Network', number: '230', category: 'Lifestyle' },
  { id: 'tastemade', name: 'Tastemade', number: '235', category: 'Lifestyle' },
  { id: 'so-yummy', name: 'So Yummy', number: '563', category: 'Lifestyle' },

  // ================== HALLMARK ==================
  { id: 'hallmark', name: 'Hallmark Channel', number: '312', category: 'Entertainment' },
  { id: 'hallmark-drama', name: 'Hallmark Drama', number: '564', category: 'Entertainment' },
  { id: 'hallmark-movies', name: 'Hallmark Movies & Mysteries', number: '565', category: 'Entertainment' },
  { id: 'gac-family', name: 'GAC Family', number: '326', category: 'Entertainment' },

  // ================== KIDS ==================
  { id: 'disney', name: 'Disney Channel', number: '290', category: 'Kids', searchTerms: ['Disney Channel East'] },
  { id: 'disney-west', name: 'Disney Channel West', number: '291', category: 'Kids' },
  { id: 'disney-xd', name: 'Disney XD', number: '292', category: 'Kids' },
  { id: 'disney-jr', name: 'Disney Junior', number: '289', category: 'Kids' },
  { id: 'nick', name: 'Nickelodeon', number: '299', category: 'Kids', searchTerms: ['Nickelodeon/Nick at Nite', 'Nick'] },
  { id: 'nick-west', name: 'Nickelodeon West', number: '300', category: 'Kids' },
  { id: 'nick-jr', name: 'Nick Jr.', number: '301', category: 'Kids' },
  { id: 'nicktoons', name: 'Nicktoons', number: '302', category: 'Kids' },
  { id: 'teennick', name: 'TeenNick', number: '303', category: 'Kids' },
  { id: 'cartoon-network', name: 'Cartoon Network', number: '296', category: 'Kids', searchTerms: ['Cartoon Network East'] },
  { id: 'cartoon-network-west', name: 'Cartoon Network West', number: '297', category: 'Kids' },
  { id: 'boomerang', name: 'Boomerang', number: '298', category: 'Kids' },
  { id: 'pbs-kids', name: 'PBS Kids', number: '288', category: 'Kids' },
  { id: 'universal-kids', name: 'Universal Kids', number: '295', category: 'Kids' },
  { id: 'babyfirst', name: 'BabyFirst HD', number: '293', category: 'Kids' },

  // ================== SHOPPING ==================
  { id: 'qvc', name: 'QVC', number: '275', category: 'Shopping' },
  { id: 'qvc2', name: 'QVC2', number: '315', category: 'Shopping' },
  { id: 'qvc3', name: 'QVC3', number: '318', category: 'Shopping' },
  { id: 'hsn', name: 'HSN', number: '240', category: 'Shopping' },
  { id: 'hsn2', name: 'HSN 2', number: '310', category: 'Shopping' },
  { id: 'shophq', name: 'ShopHQ', number: '316', category: 'Shopping' },
  { id: 'shop-lc', name: 'Shop LC', number: '226', category: 'Shopping' },
  { id: 'jewelry-tv', name: 'Jewelry TV', number: '313', category: 'Shopping' },

  // ================== RELIGIOUS ==================
  { id: 'insp', name: 'INSP', number: '364', category: 'Religious' },
  { id: 'god-tv', name: 'GOD TV', number: '365', category: 'Religious' },
  { id: 'victory', name: 'Victory', number: '366', category: 'Religious' },
  { id: 'world-harvest', name: 'World Harvest Television', number: '367', category: 'Religious' },
  { id: 'hope-channel', name: 'Hope Channel', number: '368', category: 'Religious' },
  { id: 'daystar', name: 'Daystar', number: '369', category: 'Religious' },
  { id: 'ewtn', name: 'EWTN', number: '370', category: 'Religious' },
  { id: 'tbn-inspire', name: 'TBN Inspire', number: '371', category: 'Religious' },
  { id: 'tbn', name: 'Trinity Broadcasting Network', number: '372', category: 'Religious', searchTerms: ['TBN'] },
  { id: 'word-network', name: 'The Word Network', number: '373', category: 'Religious' },
  { id: 'byutv', name: 'BYUtv', number: '374', category: 'Religious' },
  { id: 'link-tv', name: 'Link TV', number: '375', category: 'Religious' },
  { id: 'ctn', name: 'CTN', number: '376', category: 'Religious' },
  { id: 'tct', name: 'TCT Network', number: '377', category: 'Religious' },
  { id: 'nrb', name: 'NRB', number: '378', category: 'Religious' },
  { id: 'living-faith', name: 'Living Faith Network', number: '379', category: 'Religious' },
  { id: 'impact', name: 'IMPACT', number: '380', category: 'Religious' },
  { id: 'sbn', name: 'SBN', number: '344', category: 'Religious' },
  { id: 'rfd-tv', name: 'RFD-TV', number: '345', category: 'Religious' },
  { id: 'scientology', name: 'Scientology Network', number: '320', category: 'Religious' },
  { id: 'jltv', name: 'Jewish Life TV', number: '325', category: 'Religious' },

  // ================== SPANISH ==================
  { id: 'univision', name: 'Univision', number: '402', category: 'Spanish', searchTerms: ['Univision Este'] },
  { id: 'univision-west', name: 'Univision Oeste', number: '403', category: 'Spanish' },
  { id: 'galavision', name: 'Galavisión', number: '404', category: 'Spanish' },
  { id: 'megatv', name: 'MegaTV', number: '405', category: 'Spanish' },
  { id: 'telemundo', name: 'Telemundo', number: '406', category: 'Spanish', searchTerms: ['Telemundo Este'] },
  { id: 'telemundo-west', name: 'Telemundo Oeste', number: '407', category: 'Spanish' },
  { id: 'unimas', name: 'UniMás', number: '408', category: 'Spanish' },
  { id: 'veplus', name: 'VePlus', number: '409', category: 'Spanish' },
  { id: 'universo', name: 'UNIVERSO', number: '410', category: 'Spanish' },
  { id: 'telefe', name: 'Telefe', number: '411', category: 'Spanish' },
  { id: 'multimedios', name: 'Multimedios', number: '412', category: 'Spanish' },
  { id: 'discovery-espanol', name: 'Discovery En Español', number: '413', category: 'Spanish' },
  { id: 'wapa-america', name: 'WAPA América', number: '414', category: 'Spanish' },
  { id: 'videorola', name: 'Videorola', number: '415', category: 'Spanish' },
  { id: 'nuestra-tele', name: 'Nuestra Tele', number: '416', category: 'Spanish' },
  { id: 'caracol-tv', name: 'Caracol TV', number: '417', category: 'Spanish' },
  { id: 'ntn24', name: 'NTN24', number: '418', category: 'Spanish' },
  { id: 'cnn-espanol', name: 'CNN En Español', number: '419', category: 'Spanish' },
  { id: 'a3series', name: 'A3Series', number: '420', category: 'Spanish' },
  { id: 'cine-estelar', name: 'Cine Estelar', number: '422', category: 'Spanish' },
  { id: 'cinelatino', name: 'Cinelatino', number: '423', category: 'Spanish' },
  { id: 'cine-nostalgia', name: 'Cine Nostalgia', number: '424', category: 'Spanish' },
  { id: 'babytv-es', name: 'BabyTV', number: '425', category: 'Spanish' },
  { id: 'tvv', name: 'TVV', number: '427', category: 'Spanish' },
  { id: 'centroamerica-tv', name: 'Centroamérica TV', number: '428', category: 'Spanish' },
  { id: 'telecentro', name: 'TeleCentro', number: '429', category: 'Spanish' },
  { id: 'hola-tv', name: '¡Hola! TV', number: '430', category: 'Spanish' },
  { id: 'peru-magico', name: 'Perú Mágico', number: '431', category: 'Spanish' },
  { id: 'zoomoo', name: 'ZooMoo', number: '432', category: 'Spanish' },
  { id: 'bandamax', name: 'Bandamax', number: '433', category: 'Spanish' },
  { id: 'hogar-hgtv', name: 'Hogar de HGTV', number: '434', category: 'Spanish' },
  { id: 'natgeo-mundo', name: 'Nat Geo Mundo', number: '435', category: 'Spanish' },
  { id: 'discovery-familia', name: 'Discovery Familia', number: '436', category: 'Spanish' },
  { id: 'tv-chile', name: 'TV Chile', number: '437', category: 'Spanish' },
  { id: 'ecuavisa', name: 'Ecuavisa Internacional', number: '438', category: 'Spanish' },
  { id: 'sur-peru', name: 'SUR Perú', number: '439', category: 'Spanish' },
  { id: 'vme', name: 'Vme', number: '440', category: 'Spanish' },
  { id: 'azteca', name: 'Azteca', number: '441', category: 'Spanish' },
  { id: 'estrella-tv', name: 'Estrella TV', number: '442', category: 'Spanish' },
  { id: 'history-espanol', name: 'History En Español', number: '443', category: 'Spanish' },
  { id: 'pasiones', name: 'Pasiones', number: '444', category: 'Spanish' },
  { id: 'tr3s', name: 'Tr3s', number: '445', category: 'Spanish' },
  { id: 'canal-22', name: 'Canal 22 Internacional', number: '446', category: 'Spanish' },
  { id: 'once-mexico', name: 'ONCE MEXICO', number: '447', category: 'Spanish' },
  { id: 'enlace', name: 'Enlace', number: '448', category: 'Spanish' },
  { id: 'sony-cine', name: 'Sony Cine', number: '449', category: 'Spanish' },
  { id: 'viendomovies', name: 'ViendoMovies', number: '450', category: 'Spanish' },
  { id: 'de-pelicula', name: 'De Película', number: '451', category: 'Spanish' },
  { id: 'de-pelicula-clasico', name: 'De Película Clásico', number: '452', category: 'Spanish' },
  { id: 'forotv', name: 'FOROtv', number: '453', category: 'Spanish' },
  { id: 'univision-tlnovelas', name: 'Univision tlnovelas', number: '454', category: 'Spanish' },
  { id: 'esne', name: 'ESNE', number: '456', category: 'Spanish' },
  { id: 'ecuador-tv', name: 'Ecuador TV', number: '457', category: 'Spanish' },
  { id: 'antena-3', name: 'Antena 3', number: '458', category: 'Spanish' },
  { id: 'atres-cine', name: 'Atres Cine', number: '459', category: 'Spanish' },
  { id: 'tve', name: 'TVE', number: '460', category: 'Spanish' },
  { id: 'hitn', name: 'HITN', number: '461', category: 'Spanish' },
  { id: 'cine-mexicano', name: 'Cine Mexicano', number: '462', category: 'Spanish' },
  { id: 'nuestra-vision', name: 'Nuestra Vision', number: '472', category: 'Spanish' },
  { id: 'estrella-news', name: 'Estrella News', number: '473', category: 'Spanish' },
  { id: 'meganoticias', name: 'Meganoticias', number: '474', category: 'Spanish' },

  // ================== INTERNATIONAL ==================
  { id: 'phoenix-info', name: 'Phoenix Info News', number: '2051', category: 'International' },
  { id: 'cctv', name: 'CCTV', number: '2052', category: 'International' },
  { id: 'cgtn', name: 'CGTN', number: '2053', category: 'International' },
  { id: 'charming-china', name: 'Charming China', number: '2055', category: 'International' },
  { id: 'cti-zhongtian', name: 'CTI Zhong-Tian', number: '2056', category: 'International' },
  { id: 'cbo', name: 'CBO', number: '2057', category: 'International' },
  { id: 'gztv', name: 'GZTV', number: '2102', category: 'International' },
  { id: '88tv', name: '88TV', number: '2103', category: 'International' },
  { id: 'phoenix-hk', name: 'Phoenix Hong Kong Channel', number: '2104', category: 'International' },
  { id: '88films', name: '88Films', number: '2105', category: 'International' },
  { id: 'icable-financial', name: 'iCable Financial Info News', number: '2108', category: 'International' },
  { id: 'icable-news', name: 'I-Cable News', number: '2109', category: 'International' },
  { id: 'phoenix-tv', name: 'Phoenix TV', number: '2115', category: 'International' },
  { id: 'tv-globo', name: 'TV Globo', number: '2134', category: 'International' },
  { id: 'sportv', name: 'SporTV', number: '2135', category: 'International' },

  // ================== 4K ==================
  { id: 'directv-4k', name: 'DIRECTV 4K1', number: '104', category: '4K' },
  { id: 'directv-4k-live1', name: 'DIRECTV 4K Live1', number: '105', category: '4K' },
  { id: 'directv-4k-live2', name: 'DIRECTV 4K Live 2', number: '106', category: '4K' },
  { id: 'directv-sportsmix', name: 'DIRECTV HD SPORTSMIX', number: '205', category: '4K' },

  // ================== JBS ==================
  { id: 'jbs', name: 'JBS', number: '388', category: 'Religious' },
  { id: 'fm', name: 'FM', number: '386', category: 'Entertainment' },
];

// Generate URL for channel
// DirecTV Stream URL format - can be overridden per channel with 'url' field
function getChannelUrl(channel) {
  // If channel has explicit URL, use it
  if (channel.url) {
    return channel.url;
  }
  // Default: use channel number
  return `https://stream.directv.com/watch/${channel.number}`;
}

// Get channel by ID
function getChannel(id) {
  // First try to find by channel ID (e.g., 'espn')
  let channel = channels.find(ch => ch.id === id);

  // If not found, try by channel number (e.g., '206')
  if (!channel) {
    channel = channels.find(ch => ch.number === id || ch.number === String(id));
  }

  return channel;
}

// Get all channels with URLs
function getAllChannels() {
  return channels.map(ch => ({
    ...ch,
    url: getChannelUrl(ch),
  }));
}

// Get channels by category
function getChannelsByCategory(category) {
  return channels
    .filter(ch => ch.category.toLowerCase() === category.toLowerCase())
    .map(ch => ({
      ...ch,
      url: getChannelUrl(ch),
    }));
}

// Generate M3U playlist
function generateM3U(serverHost) {
  let m3u = '#EXTM3U\n';
  m3u += '#EXTM3U x-tvg-url=""\n\n';

  for (const ch of channels) {
    m3u += `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}" `;
    m3u += `tvg-chno="${ch.number}" group-title="${ch.category}",${ch.name}\n`;
    m3u += `http://${serverHost}/stream/${ch.id}\n`;
  }

  return m3u;
}

// Search channels by name (case-insensitive)
function searchChannels(query) {
  const q = query.toLowerCase();
  return channels.filter(ch =>
    ch.name.toLowerCase().includes(q) ||
    ch.id.includes(q) ||
    ch.number.includes(q) ||
    (ch.searchTerms && ch.searchTerms.some(t => t.toLowerCase().includes(q)))
  );
}

module.exports = {
  channels,
  getChannel,
  getChannelUrl,
  getAllChannels,
  getChannelsByCategory,
  generateM3U,
  searchChannels,
};
