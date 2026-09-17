export default async function handler(req, res) {
  try {
    const business = String(req.query.business || "").trim();
    const location = String(req.query.location || "").trim();

    if (!business || !location) {
      return res.status(400).json({
        error: "Business and location are required."
      });
    }

    // Convert location to coordinates
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

    /*
     * Determine what kind of businesses the user wants.
     */

    const q = business.toLowerCase();

    let osmFilter = `
      ["name"]
      ["amenity"]
    `;

    if (
      q.includes("mobile") ||
      q.includes("phone") ||
      q.includes("smartphone")
    ) {
      osmFilter = `
        ["name"]
        ["shop"~"mobile_phone|electronics|computer"]
      `;
    }

    else if (
      q.includes("dental") ||
      q.includes("dentist")
    ) {
      osmFilter = `
        ["name"]
        ["amenity"="dentist"]
      `;
    }

    else if (
      q.includes("clinic") ||
      q.includes("doctor")
    ) {
      osmFilter = `
        ["name"]
        ["amenity"~"clinic|doctors"]
      `;
    }

    else if (
      q.includes("bakery")
    ) {
      osmFilter = `
        ["name"]
        ["shop"="bakery"]
      `;
    }

    else if (
      q.includes("restaurant")
    ) {
      osmFilter = `
        ["name"]
        ["amenity"="restaurant"]
      `;
    }

    else if (
      q.includes("cafe") ||
      q.includes("coffee")
    ) {
      osmFilter = `
        ["name"]
        ["amenity"="cafe"]
      `;
    }

    else if (
      q.includes("hotel")
    ) {
      osmFilter = `
        ["name"]
        ["tourism"="hotel"]
      `;
    }

    else if (
      q.includes("salon") ||
      q.includes("beauty") ||
      q.includes("hair")
    ) {
      osmFilter = `
        ["name"]
        ["shop"~"beauty|hairdresser"]
      `;
    }

    else if (
      q.includes("car") ||
      q.includes("auto")
    ) {
      osmFilter = `
        ["name"]
        ["shop"~"car|car_repair"]
      `;
    }

    else if (
      q.includes("school")
    ) {
      osmFilter = `
        ["name"]
        ["amenity"="school"]
      `;
    }

    else if (
      q.includes("college")
    ) {
      osmFilter = `
        ["name"]
        ["amenity"="college"]
      `;
    }

    else {
      // Generic business search
      osmFilter = `["name"]`;
    }


    /*
     * Search nearby businesses.
     */

    const query = `
[out:json][timeout:25];

nwr(
  around:15000,
  ${lat},
  ${lon}
)
${osmFilter};

out center tags;
`;

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

    const results = [];
    const seen = new Set();

    for (const element of data.elements || []) {

      const tags = element.tags || {};

      if (!tags.name) continue;

      const name = tags.name.trim();

      const key = name.toLowerCase();

      if (seen.has(key)) continue;

      seen.add(key);

      let latitude = element.lat;
      let longitude = element.lon;

      if (
        element.center &&
        latitude === undefined
      ) {
        latitude = element.center.lat;
        longitude = element.center.lon;
      }

      const addressParts = [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:suburb"],
        tags["addr:city"]
      ].filter(Boolean);

      const address =
        addressParts.join(", ");

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
      source: "OpenStreetMap"
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error:
        "Unable to search businesses."
    });
  }
}
