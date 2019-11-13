### Allrecipes Scraper

Allrecipes Scraper is an [Apify actor](https://apify.com/actors) for extracting data about actors from [Allrecipes](https://www.allrecipes.com/recipes). It allows you to extract all recipes for the given search text and/or the given list of start urls. It is build on top of [Apify SDK](https://sdk.apify.com/) and you can run it both on [Apify platform](https://my.apify.com) and locally.

- [Input](#input)
- [Output](#output)
- [Compute units consumption](#compute-units-consumption)
- [Extend output function](#extend-output-function)

### Input

| Field | Type | Description | Default value
| ----- | ---- | ----------- | -------------|
| searchText | string | Search recipes by text | empty |
| startUrls | array | List of [Request](https://sdk.apify.com/docs/api/request#docsNav) objects that will be deeply crawled. The URL can be top level like `https://www.allrecipes.com/recipes`, any category/search URL or detail URL | `[{ "url": "https://www.allrecipes.com/recipe/50644" }]`|
| maxItems | number | Maximum number of actor pages that will be scraped | all found |
| extendOutputFunction | string | Function that takes a Cheerio handle ($) as argument and returns data that will be merged with the result output. More information in [Extend output function](#extend-output-function) | |
| proxyConfiguration | object | Proxy settings of the run. If you have access to Apify proxy, leave the default settings. If not, you can set `{ "useApifyProxy": false" }` to disable proxy usage | `{ "useApifyProxy": true }`|

### Output

Output is stored in a dataset. Each item is an information about a recipe. Example:

```
{
  "url": "https://www.allrecipes.com/recipe/247158/asian-steak-and-noodle-bowl/",
  "name": "Asian Steak and Noodle Bowl",
  "rating": "4.79",
  "ratingcount": "11",
  "ingredients": "1/2 cup low-sodium soy sauce, 1/3 cup vegetable oil, 1/3 cup brown sugar, 1 tablespoon minced ginger, 1/2 teaspoon garlic powder, 2 pounds flank steak, 1 (10 ounce) package dried Japanese udon noodles, 6 ounces snow peas, 1 cup broccoli florets, 1 tablespoon mirin (Japanese sweet wine)",
  "directions": "1. Whisk soy sauce, vegetable oil, brown sugar, ginger, and garlic powder together in a large bowl. Pierce flank steak several times with a large fork. Place in the bowl and cover with plastic wrap. Let marinate in the refrigerator, at least 4 hours and up to overnight. 2. Bring a large pot of salted water to a boil. Cook udon noodles in boiling water, stirring occasionally, until tender yet firm to the bite, 13 to 14 minutes. Drain. 3. Heat a large skillet over high heat. Remove steak from marinade and cook until well-browned, about 2 minutes per side. Reserve marinade. 4. Preheat grill for medium heat and lightly oil the grate. Grill steak, basting with half of the reserved marinade, until internal temperature reaches 140 degrees F (60 degrees C) for medium or 150 degrees F (65 degrees C) for medium-well, at least 10 minutes per side. Slice steak thinly against the grain. 5. Combine remaining marinade, snow peas, broccoli florets, and mirin in the skillet. Cook and stir over medium-high heat until snow peas are tender, about 2 minutes. Add drained noodles; mix well to combine. 6. Divide noodle mixture among large bowls. Top with steak slices.",
  "prep": "15 m",
  "cook": "44 m",
  "ready in": "4 h 59 m",
  "calories": "660"
}
```

### Compute units consumption
Keep in mind that it is much more efficient to run one longer scrape (at least one minute) than more shorter ones because of the startup time.

The average consumption is **1 Compute unit for 1000 actor pages** scraped

### Extend output function

You can use this function to update the result output of this actor. This function gets a JQuery handle `$` as an argument so you can choose what data from the page you want to scrape. The output from this will function will get merged with the result output.

The return value of this function has to be an object!

You can return fields to achive 3 different things:
- Add a new field - Return object with a field that is not in the result output
- Change a field - Return an existing field with a new value
- Remove a field - Return an existing field with a value `undefined`


```
($) => {
    return {
        "author": $('[itemprop=author]').text(),
        "name": "NA",
        url: undefined
    }
}
```
This example will add a new field `author`, change the `name` field and remove `url` field
```
{
  "author": "Chrissy Gaynor",
  "name": "NA",
  "rating": "4.79",
  "ratingcount": "11",
  "ingredients": "1/2 cup low-sodium soy sauce, 1/3 cup vegetable oil, 1/3 cup brown sugar, 1 tablespoon minced ginger, 1/2 teaspoon garlic powder, 2 pounds flank steak, 1 (10 ounce) package dried Japanese udon noodles, 6 ounces snow peas, 1 cup broccoli florets, 1 tablespoon mirin (Japanese sweet wine)",
  "directions": "1. Whisk soy sauce, vegetable oil, brown sugar, ginger, and garlic powder together in a large bowl. Pierce flank steak several times with a large fork. Place in the bowl and cover with plastic wrap. Let marinate in the refrigerator, at least 4 hours and up to overnight. 2. Bring a large pot of salted water to a boil. Cook udon noodles in boiling water, stirring occasionally, until tender yet firm to the bite, 13 to 14 minutes. Drain. 3. Heat a large skillet over high heat. Remove steak from marinade and cook until well-browned, about 2 minutes per side. Reserve marinade. 4. Preheat grill for medium heat and lightly oil the grate. Grill steak, basting with half of the reserved marinade, until internal temperature reaches 140 degrees F (60 degrees C) for medium or 150 degrees F (65 degrees C) for medium-well, at least 10 minutes per side. Slice steak thinly against the grain. 5. Combine remaining marinade, snow peas, broccoli florets, and mirin in the skillet. Cook and stir over medium-high heat until snow peas are tender, about 2 minutes. Add drained noodles; mix well to combine. 6. Divide noodle mixture among large bowls. Top with steak slices.",
  "prep": "15 m",
  "cook": "44 m",
  "ready in": "4 h 59 m",
  "calories": "660"
}
```

### Epilogue
Thank you for trying my actor. I will be very glad for a feedback that you can send to my email `dtrungtin@gmail.com`. If you find any bug, please create an issue on the [Github page](https://github.com/dtrungtin/actor-allrecipes-scraper).