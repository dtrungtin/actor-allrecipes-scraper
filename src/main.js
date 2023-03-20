const Apify = require('apify');

const { log, sleep } = Apify.utils;

const isObject = (val) => typeof val === 'object' && val !== null && !Array.isArray(val);

function extractData(request, $) {
    const ingredients = $('.mntl-structured-ingredients__list-item');
    const ingredientList = [];
    for (let index = 0; index < ingredients.length; index++) {
        ingredientList.push($(ingredients[index]).text().trim());
    }

    const directions = $('h2[id*=recipe__steps-heading]:contains("Directions")').next().find('li p.mntl-sc-block');
    const directionList = [];
    for (let index = 0; index < directions.length; index++) {
        const text = $(directions[index]).text().trim()
            .split('\n')
            .join('');

        if (text !== '') {
            directionList.push(`${index + 1}. ${text}`);
        }
    }

    return {
        url: request.url,
        name: $('meta[itemprop=name]').attr('content'),
        rating: $('.mntl-recipe-review-bar__rating').text().trim(),
        ratingcount: $('.mntl-recipe-review-bar__rating-count').text().match(/\d+/)[0],
        ingredients: ingredientList.join('; '),
        directions: directionList.join(' '),
        prep: $('.mntl-recipe-details__label:contains("Prep Time:")').next().text().trim(),
        cook: $('.mntl-recipe-details__label:contains("Cook Time:")').next().text().trim(),
        total: $('.mntl-recipe-details__label:contains("Total Time:")').next().text().trim(),
        calories: $('.mntl-nutrition-facts-summary__table-cell:contains("Calories")').prev().text().trim(),
        '#debug': Apify.utils.createRequestDebugInfo(request),
    };
}

Apify.main(async () => {
    const input = await Apify.getInput();
    console.log('Input:');
    console.log(input);

    if (!input || ((!Array.isArray(input.startUrls) || input.startUrls.length === 0) && (!input.searchText || input.searchText.trim() === ''))) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls' or 'searchText'.");
    } else if (input.searchText && input.startUrls && input.searchText.trim().length > 0 && input.startUrls.length > 0) {
        log.warning(`Start URLs were provided. Will not use provided search text: ${input.searchText}.`);
    }

    const startUrls = [];

    // here the actor creates and pushes new urls based on search term - plus I added that it only does so, if there is no StartUrl in input
    if (input.searchText && input.searchText.trim() !== '' && (!Array.isArray(input.startUrls) || input.startUrls.length === 0)) {
        const searchTerms = new Set(
            input.searchText.split(',')
                .map((s) => s.trim())
                .filter((s) => s),
        );

        for (const searchTerm of searchTerms) {
            const searchUrl = `https://www.allrecipes.com/search?q=${encodeURIComponent(searchTerm)}`;

            startUrls.push({
                url: searchUrl,
                userData: {
                    searchTerm,
                },
            });
        }
    }

    if (Array.isArray(input.startUrls) && input.startUrls.length) {
        // support uploading using files
        const rl = await Apify.openRequestList('INITIAL-URLS', input.startUrls);
        let req;

        while (req = await rl.fetchNextRequest()) { // eslint-disable-line no-cond-assign
            if (req.url) {
                startUrls.push({
                    url: req.url,
                });
            }
        }
    }

    let extendOutputFunction;
    if (typeof input.extendOutputFunction === 'string' && input.extendOutputFunction.trim() !== '') {
        try {
            extendOutputFunction = eval(input.extendOutputFunction); // eslint-disable-line no-eval
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof extendOutputFunction !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }

    const requestQueue = await Apify.openRequestQueue();

    const detailsParsedCount = (await Apify.getValue('DETAILS-PARSED')) || {
        DEFAULT: 0,
    };

    const persistState = async () => {
        await Apify.setValue('DETAILS-PARSED', detailsParsedCount);
    };

    Apify.events.on('persistState', persistState);

    // this needs to work cross pagination for each term
    function checkLimit(searchTerm = 'DEFAULT', extraCount = 0) {
        return input.maxItems && (detailsParsedCount[searchTerm] + extraCount) >= input.maxItems;
    }

    let existingRecipes = 0;

    const requestList = await Apify.openRequestList(
        'START-URLS',
        startUrls.map(({ url, userData }) => {
            if (/(www\.)?allrecipes\.com\//i.test(url)) { // with or without www.
                if (url.includes('/recipe/')) {
                    existingRecipes++;

                    return {
                        url,
                        userData: {
                            ...userData,
                            label: 'item',
                        },
                    };
                }

                return {
                    url,
                    userData: {
                        ...userData,
                        label: 'list',
                    },
                };
            }

            log.warning(`----\nInvalid url: ${url}\n-----\n`);
        }).filter((s) => s),
    );

    log.info(`Starting with ${requestList.length()} urls ${existingRecipes ? `and ${existingRecipes} existing recipe(s)` : ''}`);

    const proxyConfiguration = await Apify.createProxyConfiguration({ ...input.proxyConfiguration });

    const crawler = new Apify.CheerioCrawler({
        requestList,
        requestQueue,
        proxyConfiguration,

        handleRequestTimeoutSecs: 120,
        requestTimeoutSecs: 120,
        handlePageTimeoutSecs: 240,

        handlePageFunction: async ({ request, $ }) => {
            log.info(`Open url (${request.userData.label}): ${request.url}`);
            await sleep(1000);

            const { userData } = request;

            if (userData.label === 'list') {
                const itemLinks = $('a.mntl-card-list-items[href*="/recipe/"]')
                    .map((_, link) => $(link).attr('href'))
                    .get()
                    .filter((s) => s);

                if (itemLinks.length === 0) {
                    return;
                }

                let enqueued = 0;

                for (const link of itemLinks) {
                    if (checkLimit(userData.searchTerm, enqueued)) {
                        break;
                    }

                    const url = link.startsWith('https://') ? link : `https://www.allrecipes.com${link}`;

                    const rq = await requestQueue.addRequest({
                        url,
                        userData: {
                            ...userData,
                            label: 'item',
                        },
                    });

                    if (!rq.wasAlreadyPresent) {
                        enqueued++;
                    }
                }

                if (enqueued) {
                    log.info(`Enqueued ${enqueued} new recipes ${userData.searchTerm ? `for search "${userData.searchTerm}"` : ''}`, {
                        url: request.url,
                    });
                }

                // don't enqueue pagination if we've reached the limit
                if (checkLimit(userData.searchTerm, enqueued)) {
                    return;
                }

                const nextPageUrl = $('.pagination__next a').eq(0).attr('href');
                if (nextPageUrl) {
                    await requestQueue.addRequest({
                        url: `${nextPageUrl}`,
                        userData: {
                            ...userData,
                            label: 'list',
                        },
                    });
                }
            } else if (userData.label === 'item') {
                const pageResult = extractData(request, $);
                let userResult = {};

                if (extendOutputFunction) {
                    userResult = extendOutputFunction($, pageResult);

                    if (!isObject(userResult)) {
                        log.error('extendOutputFunction has to return an object!');
                        process.exit(1);
                    }
                }

                detailsParsedCount[userData.searchTerm || 'DEFAULT'] = (detailsParsedCount[userData.searchTerm || 'DEFAULT'] || 0) + 1;

                await Apify.pushData({ ...pageResult, ...userResult });
            }
        },

        handleFailedRequestFunction: async ({ request }) => {
            await Apify.pushData({
                '#isFailed': true,
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },
    });

    await crawler.run();
    await persistState();

    log.info('Done');
});
