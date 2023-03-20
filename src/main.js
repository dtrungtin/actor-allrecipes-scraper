/**
 * This template is a production ready boilerplate for developing with `CheerioCrawler`.
 * Use this to bootstrap your projects using the most up-to-date code.
 * If you're looking for examples or want to learn more, see README.
 */

// For more information, see https://docs.apify.com/sdk/js
import { Actor, log } from 'apify';
// For more information, see https://crawlee.dev
import { CheerioCrawler } from 'crawlee';
import { router } from './routes.js';
import { downloadListOfUrls } from '@crawlee/utils';

// Initialize the Apify SDK
await Actor.init();

// import { ApifyStorageLocal } from '@apify/storage-local';
// const storage = new ApifyStorageLocal();
// await Actor.init({ storage });

Actor.on('migrating', () => {
    Actor.setValue('detailsEnqueued', global.detailsEnqueued);
});

global.detailsEnqueued = await Actor.getValue('detailsEnqueued') || 0;

const input = await Actor.getInput();
console.log('Input:');
console.log(input);

if (!input || ((!Array.isArray(input.startUrls) || input.startUrls.length === 0) && (!input.searchText || input.searchText.trim() === ''))) {
    throw new Error("Invalid input, it needs to contain at least one url in 'startUrls' or 'searchText'.");
} else if (input.searchText && input.startUrls && input.searchText.trim().length > 0 && input.startUrls.length > 0) {
    log.warning(`Start URLs were provided. Will not use provided search text: ${input.searchText}.`);
}

global.maxItems = input.maxItems;

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
    if (input.startUrls[0].requestsFromUrl) {
        const listOfUrls = await downloadListOfUrls({ url: input.startUrls[0].requestsFromUrl });
        for (let index = 0; index < listOfUrls.length; index++) {
            startUrls.push({
                url: listOfUrls[index],
            });
        }
    } else {
        startUrls.push(...input.startUrls);
    }
}

if (typeof input.extendOutputFunction === 'string' && input.extendOutputFunction.trim() !== '') {
    try {
        global.extendOutputFunction = eval(input.extendOutputFunction); // eslint-disable-line no-eval
    } catch (e) {
        throw new Error(`'extendOutputFunction' is not valid Javascript! Error: ${e}`);
    }
    if (typeof extendOutputFunction !== 'function') {
        throw new Error('extendOutputFunction is not a function! Please fix it or use just default ouput!');
    }
}

let existingRecipes = 0;
const newStartUrls = startUrls.map(({ url, userData }) => {
    if (/(www\.)?allrecipes\.com\//i.test(url)) { // with or without www.
        if (url.includes('/recipe/')) {
            existingRecipes++;

            return {
                url,
                userData: {
                    ...userData,
                    label: 'detail',
                },
            };
        }

        return {
            url,
            userData: {
                ...userData
            },
        };
    }

    log.warning(`----\nInvalid url: ${url}\n-----\n`);
}).filter((s) => s);

log.info(`Starting with ${newStartUrls.length} urls ${existingRecipes ? `and ${existingRecipes} existing recipe(s)` : ''}`);

const proxyConfiguration = await Actor.createProxyConfiguration({ ...input.proxyConfiguration });

const crawler = new CheerioCrawler({
    proxyConfiguration,
    requestHandler: router,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 120,
});

await crawler.run(newStartUrls);

// Exit successfully
await Actor.exit();
