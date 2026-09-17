export default async function handler(req, res) {
  try {
    const business = String(req.query.business || "").trim();
    const location = String(req.query.location || "").trim();

    if (!business || !location) {
      return res.status(400).json({
        error: "Business and location are required."
      });
    }

    // -----------------------------
    // 1. FIND LOCATION
    // -----------------------------

    const geoURL =
      "https://nominatim.openstreetmap.org/search" +
      "?format=json&limit=1&q=" +
      encodeURIComponent(location);

    const geoResponse = await fetch(geoURL, {
      headers: {
        "User-Agent": "LeadFinderAI/1.0"
      }
    });

    const geo = await geoResponse.json();

    if (!geo.length) {
      return res.status(404).json({
        error: "Location not found."
      });
    }

    const lat = parseFloat(geo[0].lat);
    const lon = parseFloat(geo[0].lon);

    const q = business.toLowerCase();

    // -----------------------------
    // 2. DETERMINE CATEGORY
    // -----------------------------

    let mode = "generic";

    if (
      q.includes("mobile") ||
      q.includes("phone") ||
      q.includes("smartphone")
    ) {
      mode = "mobile";
    }

    else if (
      q.includes("dental") ||
      q.includes("dentist")
    ) {
      mode = "dental";
    }

    else if (
      q.includes("clinic") ||
      q.includes("doctor")
    ) {
      mode = "clinic";
    }

    else if (
      q.includes("bakery") ||
      q.includes("bake")
    ) {
      mode = "bakery";
    }

    else if (
      q.includes("tea") ||
      q.includes("coffee") ||
      q.includes("cafe")
    ) {
      mode = "tea";
    }

    else if (
      q.includes("restaurant") ||
      q.includes("hotel") ||
      q.includes("salon") ||
      q.includes("school") ||
      q.includes("college")
    ) {
      mode = "named";
    }


    // -----------------------------
    // 3. OSM QUERY
    // -----------------------------

    let query;

    if (mode === "mobile") {

      query = `
[out:json][timeout:25];

nwr(
  around:15000,
  ${lat},
  ${lon}
)["name"]["shop"~"mobile_phone|electronics|computer"];

out center tags;
`;

    }

    else if (mode === "dental") {

      query = `
[out:json][timeout:25];

nwr(
  around:15000,
  ${lat},
  ${lon}
)["name"]["amenity"="dentist"];

out center tags;
`;

    }

    else if (mode === "clinic") {

      query = `
[out:json][timeout:25];

nwr(
  around:15000,
  ${lat},
  ${lon}
)["name"]["amenity"~"clinic|doctors|hospital"];

out center tags;
`;

    }

    else if (mode === "bakery") {

      query = `
[out:json][timeout:25];

nwr(
  around:15000,
  ${lat},
  ${lon}
)["name"]["shop"="bakery"];

out center tags;
`;

    }

    else if (mode === "tea") {

      query = `
[out:json][timeout:25];

(
  nwr(
    around:15000,
    ${lat},
    ${lon}
  )["name"]["amenity"="cafe"];

  nwr(
    around:15000,
    ${lat},
    ${lon}
  )["name"]["amenity"="fast_food"];

  nwr(
    around:15000,
    ${lat},
    ${lon}
  )["name"]["amenity"="restaurant"];

  nwr(
    around:15000,
    ${lat},
    ${lon}
  )["name"]["shop"];
);

out center tags;
`;

    }

    else {

      query = `
[out:json][timeout:25];

(
  nwr(
    around:15000,
    ${lat},
    ${lon}
  )["name"]["amenity"];

  nwr(
    around:15000,
    ${lat},
    ${lon}
  )["name"]["shop"];

  nwr(
    around:15000,
    ${lat},
    ${lon}
  )["name"]["tourism"];
);

out center tags;
`;

    }


    // -----------------------------
    // 4. REQUEST OVERPASS
    // -----------------------------

    const overpassResponse = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",

          "User-Agent":
            "LeadFinderAI/1.0"
        },

        body:
          "data=" +
          encodeURIComponent(query)
      }
    );


    if (!overpassResponse.ok) {
      throw new Error("Overpass request failed");
    }

    const data = await overpassResponse.json();


    // -----------------------------
    // 5. FILTER RESULTS
    // -----------------------------

    const results = [];
    const seen = new Set();

    for (const element of data.elements || []) {

      const tags = element.tags || {};

      if (!tags.name) continue;

      const name =
        String(tags.name).trim();

      const searchText = (

        name + " " +
        (tags.shop || "") + " " +
        (tags.amenity || "") + " " +
        (tags.cuisine || "") + " " +
        (tags.description || "")

      ).toLowerCase();


      let relevant = true;


      // MOBILE
      if (mode === "mobile") {

        relevant =
          searchText.includes("mobile") ||
          searchText.includes("phone") ||
          searchText.includes("electronics") ||
          searchText.includes("computer");

      }


      // DENTAL
      else if (mode === "dental") {

        relevant =
          tags.amenity === "dentist" ||
          searchText.includes("dental") ||
          searchText.includes("dentist");

      }


      // CLINIC
      else if (mode === "clinic") {

        relevant =
          tags.amenity === "clinic" ||
          tags.amenity === "doctors" ||
          tags.amenity === "hospital" ||
          searchText.includes("clinic") ||
          searchText.includes("hospital") ||
          searchText.includes("medical");

      }


      // BAKERY
      else if (mode === "bakery") {

        relevant =
          tags.shop === "bakery" ||
          searchText.includes("bakery") ||
          searchText.includes("bake");

      }


      // TEA / CAFE
      else if (mode === "tea") {

        relevant =
          tags.amenity === "cafe" ||
          tags.amenity === "fast_food" ||
          tags.amenity === "restaurant" ||
          searchText.includes("tea") ||
          searchText.includes("cafe") ||
          searchText.includes("coffee") ||
          searchText.includes("chai");

      }


      // NAMED SEARCH
      else if (mode === "named") {

        const words =
          q
            .split(/\s+/)
            .filter(word => word.length > 2);

        relevant =
          words.some(word =>
            searchText.includes(word)
          );

      }


      if (!relevant) continue;


      const key =
        name.toLowerCase();

      if (seen.has(key)) continue;

      seen.add(key);


      // -----------------------------
      // 6. LOCATION
      // -----------------------------

      let latitude =
        element.lat;

      let longitude =
        element.lon;

      if (
        element.center &&
        latitude === undefined
      ) {

        latitude =
          element.center.lat;

        longitude =
          element.center.lon;

      }


      const addressParts = [

        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:suburb"],
        tags["addr:city"]

      ].filter(Boolean);


      const address =
        addressParts.join(", ");


      // -----------------------------
      // 7. BUSINESS DATA
      // -----------------------------

      const website =
        tags.website ||
        tags["contact:website"] ||
        "";

      const phone =
        tags.phone ||
        tags["contact:phone"] ||
        "";

      const category =
        tags.amenity ||
        tags.shop ||
        tags.tourism ||
        "Business";


      results.push({

        id:
          element.type +
          "_" +
          element.id,

        name,

        category,

        location:
          address || location,

        website,

        phone,

        rating:
          parseFloat(tags.stars || 0),

        reviews: 0,

        latitude,

        longitude

      });


      if (results.length >= 50) {
        break;
      }

    }


    return res.status(200).json({

      results,

      count:
        results.length,

      source:
        "OpenStreetMap"

    });


  } catch (error) {

    console.error(error);

    return res.status(500).json({

      error:
        "Unable to search businesses."

    });

  }
}
