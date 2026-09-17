export default async function handler(req, res) {

    try {

        const business =
            String(req.query.business || "").trim();

        const location =
            String(req.query.location || "").trim();

        if (!business || !location) {

            return res.status(400).json({
                error: "Business and location are required."
            });

        }

        /*
         * First convert the user's location into coordinates.
         */

        const geoURL =
            "https://nominatim.openstreetmap.org/search" +
            "?format=json" +
            "&limit=1" +
            "&q=" +
            encodeURIComponent(location);

        const geoResponse =
            await fetch(geoURL, {
                headers: {
                    "User-Agent":
                        "LeadFinderAI/1.0"
                }
            });

        const geo =
            await geoResponse.json();

        if (!geo.length) {

            return res.status(404).json({
                error: "Location not found."
            });

        }

        const lat =
            parseFloat(geo[0].lat);

        const lon =
            parseFloat(geo[0].lon);


        /*
         * Search OpenStreetMap through Overpass.
         */

        const query = `

[out:json][timeout:25];

(
  nwr(
    around:15000,
    ${lat},
    ${lon}
  )["name"]["amenity"~"clinic|doctors|dentist|hospital|pharmacy|restaurant|cafe|bakery|fast_food|school|college|hotel|beauty|hairdresser|car_repair|shop"];

  nwr(
    around:15000,
    ${lat},
    ${lon}
  )["name"]["shop"];

);

out center tags;

`;


        const overpassResponse =
            await fetch(
                "https://overpass-api.de/api/interpreter",
                {
                    method:"POST",
                    headers:{
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


        if(!overpassResponse.ok){

            throw new Error(
                "Overpass request failed"
            );

        }


        const data =
            await overpassResponse.json();


        /*
         * Convert OSM objects into our lead format.
         */

        const results = [];

        const seen = new Set();


        for(const element of data.elements || []){

            const tags =
                element.tags || {};

            const name =
                tags.name;

            if(!name)
                continue;


            /*
             * Basic category matching.
             */

            const searchText =
                (
                    business +
                    " " +
                    name +
                    " " +
                    (tags.amenity || "") +
                    " " +
                    (tags.shop || "")
                ).toLowerCase();


            const requested =
                business.toLowerCase();


            /*
             * Keep broadly relevant results.
             * We deliberately don't pretend OSM has
             * Google's exact ranking.
             */

            const relevant =
                requested.includes("clinic")
                ? (
                    searchText.includes("clinic") ||
                    searchText.includes("doctor") ||
                    searchText.includes("dentist") ||
                    searchText.includes("hospital")
                  )
                : requested.includes("restaurant")
                ? (
                    searchText.includes("restaurant") ||
                    searchText.includes("cafe") ||
                    searchText.includes("fast_food")
                  )
                : true;


            if(!relevant)
                continue;


            const key =
                name.toLowerCase();


            if(seen.has(key))
                continue;


            seen.add(key);


            let latitude =
                element.lat;

            let longitude =
                element.lon;


            if(
                element.center &&
                latitude === undefined
            ){

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


            let category =
                tags.amenity ||
                tags.shop ||
                "Business";


            const website =
                tags.website ||
                tags["contact:website"] ||
                "";


            const phone =
                tags.phone ||
                tags["contact:phone"] ||
                "";


            const rating =
                parseFloat(
                    tags.stars || 0
                );


            results.push({

                id:
                    element.type +
                    "_" +
                    element.id,

                name,

                category,

                location:
                    address ||
                    location,

                website,

                phone,

                rating,

                reviews:0,

                latitude,

                longitude

            });


            if(results.length >= 50)
                break;

        }


        return res.status(200).json({
            results
        });


    } catch(error) {

        console.error(error);

        return res.status(500).json({
            error:
                "Unable to search businesses."
        });

    }

}