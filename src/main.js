const Apify = require('apify');
const _ = require('underscore');
const safeEval = require('safe-eval');
const querystring = require('querystring');

function delay(time) {
    return new Promise(((resolve) => {
        setTimeout(resolve, time);
    }));
}

const isObject = val => typeof val === 'object' && val !== null && !Array.isArray(val);

function extractData(request, $) {
    const ingredients = $('[itemprop=recipeIngredient]').length > 0 ? $('[itemprop=recipeIngredient]')
        : $('.ingredients-section .ingredients-item');
    const ingredientList = [];

    for (let index = 0; index < ingredients.length; index++) {
        ingredientList.push($(ingredients[index]).text());
    }

    const directions = $('.recipe-directions__list--item').length > 0 ? $('.recipe-directions__list--item')
        : $('.instructions-section .section-body');
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
        name: $('#recipe-main-content').length > 0 ? $('#recipe-main-content').text() : $('.recipe-main-header .heading-content').text(),
        rating: $('meta[itemprop=ratingValue]').length > 0 ? $('meta[itemprop=ratingValue]').attr('content')
            : $('meta[name="og:rating"]').attr('content'),
        ratingcount: $('.made-it-count').length > 0 ? $('.made-it-count').next().text().split('made it')[0].trim()
            : $('.ugc-ratings-item').text().split(' ')[0],
        ingredients: ingredientList.join(', '),
        directions: directionList.join(' '),
        prep: $('[itemprop=prepTime]').length > 0 ? $('[itemprop=prepTime]').text()
            : $('.recipe-meta-item .recipe-meta-item-header:contains("prep:")').next().text().split(' ')[0],
        cook: $('[itemprop=cookTime]').length > 0 ? $('[itemprop=cookTime]').text()
            : $('.recipe-meta-item .recipe-meta-item-header:contains("cook:")').next().text().split(' ')[0],
        'ready in': $('[itemprop=totalTime]').length > 0 ? $('[itemprop=totalTime]').text()
            : $('.recipe-meta-item .recipe-meta-item-header:contains("total:")').next().text().split(' ')[0],
        calories: $('[itemprop=calories]').length > 0 ? $('[itemprop=calories]').text().split(' ')[0]
            : $('.recipe-nutrition-section .section-body').text().split(' ')[0],
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

    if (!input || ((!Array.isArray(input.startUrls) || input.startUrls.length === 0) && (!input.searchText || input.searchText.trim() === ''))) {
        throw new Error("Invalid input, it needs to contain at least one url in 'startUrls' or 'searchText'.");
    }

    const startUrls = [];

    if (input.searchText && input.searchText.trim() !== '') {
        const searchUrl = `https://www.allrecipes.com/search/results/?wt=${querystring.escape(input.searchText)}`;
        startUrls.push(searchUrl);
    }

    if (Array.isArray(input.startUrls)) {
        for (const request of input.startUrls) {
            startUrls.push(request.url);
        }
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

    for (const startUrl of startUrls) {
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

        handlePageFunction: async ({ request, $ }) => {
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
                        detailsEnqueued++;
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
