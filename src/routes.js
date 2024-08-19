import { Dataset, createCheerioRouter, log } from 'crawlee';

export const router = createCheerioRouter();

const isObject = (val) => typeof val === 'object' && val !== null && !Array.isArray(val);

// this needs to work cross pagination for each term
function checkLimit() {
    return global.maxItems && global.detailsEnqueued >= global.maxItems;
}

function extractData(request, $) {
    const ingredients = $('.mm-recipes-structured-ingredients__list-item');
    const ingredientList = [];
    for (let index = 0; index < ingredients.length; index++) {
        ingredientList.push($(ingredients[index]).text().trim());
    }

    const directions = $('h2[id*=recipes-steps__heading]:contains("Directions")').next().find('li p.mntl-sc-block');
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
        rating: $('.mm-recipes-review-bar__rating').text().trim(),
        ratingcount: $('.mm-recipes-review-bar__rating-count').text().match(/\d+/)[0],
        ingredients: ingredientList.join('; '),
        directions: directionList.join(' '),
        prep: $('.mm-recipes-details__label:contains("Prep Time:")').next().text().trim(),
        cook: $('.mm-recipes-details__label:contains("Cook Time:")').next().text().trim(),
        total: $('.mm-recipes-details__label:contains("Total Time:")').next().text().trim(),
        calories: $('.mm-recipes-nutrition-facts-summary__table-cell:contains("Calories")').prev().text().trim(),
    };
}

router.addDefaultHandler(async ({ $, request, crawler }) => {
    const { userData } = request;
    const title = $('title').text();
    log.info(`${title}`, { url: request.loadedUrl });

    const itemLinks = $('a.mntl-card-list-items[href*="/recipe/"]')
        .map((_, link) => $(link).attr('href'))
        .get()
        .filter((s) => s);

    if (itemLinks.length === 0) {
        return;
    }

    let requests = [];
    for (const link of itemLinks) {
        if (checkLimit()) {
            break;
        }

        const url = link.startsWith('https://') ? link : `https://www.allrecipes.com${link}`;
        requests.push({
            url,
            userData: {
                ...userData,
                label: 'detail',
            },
        });
        global.detailsEnqueued++;
    }

    await crawler.addRequests(requests);

    if (checkLimit()) {
        return;
    }

    const nextPageUrl = $('.pagination__next a').eq(0).attr('href');
    if (nextPageUrl) {
        requests = [{
            url: `${nextPageUrl}`,
            userData: {
                ...userData,
            },
        }];
    }

    await crawler.addRequests(requests);
});

router.addHandler('detail', async ({ request, $ }) => {
    const title = $('title').text();
    log.info(`${title}`, { url: request.loadedUrl });

    const pageResult = extractData(request, $);
    let userResult = {};

    if (global.extendOutputFunction) {
        userResult = global.extendOutputFunction($, pageResult);

        if (!isObject(userResult)) {
            log.error('extendOutputFunction has to return an object!');
            process.exit(1);
        }
    }

    global.detailsEnqueued++;

    await Dataset.pushData({ ...pageResult, ...userResult });
});
