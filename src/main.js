const Apify = require('apify');
const _ = require('underscore');
const safeEval = require('safe-eval');

function delay(time) {
    return new Promise(((resolve) => {
        setTimeout(resolve, time);
    }));
}

const isObject = (val) => typeof val === 'object' && val !== null && !Array.isArray(val);

function extractData(request, $) {
    const ingredients = $('[itemprop=recipeIngredient]');
    const ingredientList = [];

    for (let index = 0; index < ingredients.length; index++) {
        ingredientList.push($(ingredients[index]).text());
    }

    const directions = $('.recipe-directions__list--item');
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
        name: $('#recipe-main-content').text(),
        rating: $('meta[itemprop=ratingValue]').attr('content'),
        ratingcount: $('meta[itemprop=reviewCount]').attr('content'),
        ingredients: ingredientList.join(', '),
        directions: directionList.join(' '),
        prep: $('[itemprop=prepTime]').text(),
        cook: $('[itemprop=cookTime]').text(),
        'ready in': $('[itemprop=totalTime]').text(),
        calories: $('[itemprop=calories]').text().split(' ')[0],
        '#debug': Apify.utils.createRequestDebugInfo(request),
    };
}

let detailsEnqueued = 0;

Apify.events.on('migrating', async () => {
    await Apify.setValue('detailsEnqueued', detailsEnqueued);
});

Apify.main(async () => {
    const input = await Apify.getInput();
    console.log('Input:');
    console.log(input);

    if (!input || !Array.isArray(input.startUrls) || input.startUrls.length === 0) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls'.");
    }

    let extendOutputFunction;
    if (typeof input.extendOutputFunction === 'string' && input.extendOutputFunction.trim() !== '') {
        try {
            extendOutputFunction = safeEval(input.extendOutputFunction);
        } catch (e) {
            throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
        }
        if (typeof extendOutputFunction !== 'function') {
            throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
        }
    }

    const requestQueue = await Apify.openRequestQueue();

    detailsEnqueued = await Apify.getValue('detailsEnqueued');
    if (!detailsEnqueued) {
        detailsEnqueued = 0;
    }

    function checkLimit() {
        return input.maxItems && detailsEnqueued >= input.maxItems;
    }

    for (const request of input.startUrls) {
        const startUrl = request.url;

        if (checkLimit()) {
            break;
        }

        if (startUrl.includes('https://www.allrecipes.com/')) {
            if (startUrl.includes('/recipe/')) {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'item' } });
            } else {
                await requestQueue.addRequest({ url: startUrl, userData: { label: 'list' } });
            }
        }
    }

    const crawler = new Apify.CheerioCrawler({
        requestQueue,

        handleRequestTimeoutSecs: 120,
        requestTimeoutSecs: 120,
        handlePageTimeoutSecs: 240,
        maxConcurrency: 5,

        handlePageFunction: async ({ request, autoscaledPool, $ }) => {
            await delay(1000);

            if (request.userData.label === 'list') {
                const itemLinks = $('.fixed-recipe-card > .fixed-recipe-card__info > a');
                if (itemLinks.length === 0) {
                    return;
                }

                for (let index = 0; index < itemLinks.length; index++) {
                    if (checkLimit()) {
                        return;
                    }

                    const itemUrl = $(itemLinks[index]).attr('href');
                    if (itemUrl) {
                        await requestQueue.addRequest({ url: `${itemUrl}`, userData: { label: 'item' } });
                    }
                }

                const nextPageUrl = $('link[rel=next]').attr('href');
                await requestQueue.addRequest({ url: `${nextPageUrl}`, userData: { label: 'list' } });
            } else if (request.userData.label === 'item') {
                const pageResult = extractData(request, $);

                if (extendOutputFunction) {
                    const userResult = await extendOutputFunction($);

                    if (!isObject(userResult)) {
                        console.log('extendOutputFunction has to return an object!!!');
                        process.exit(1);
                    }

                    _.extend(pageResult, userResult);
                }

                await Apify.pushData(pageResult);
            }
        },

        handleFailedRequestFunction: async ({ request }) => {
            await Apify.pushData({
                '#isFailed': true,
                '#debug': Apify.utils.createRequestDebugInfo(request),
            });
        },

        ...input.proxyConfiguration,
    });

    await crawler.run();
});
