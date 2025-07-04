// --- Imports ---
const axios = require('axios'); // Use require for Node.js environments in Vercel

// --- Environment Variables ---
// IMPORTANT: These will be set in your Vercel project settings.
const CIRCLE_API_TOKEN = process.env.CIRCLE_API_TOKEN;
// Adjust the URL based on Circle's actual API documentation.
// This is a placeholder and might need to be different.
const CIRCLE_API_URL_MEMBERS = 'https://api.circle.so/v1/members';
const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_SITE_ID = process.env.WEBFLOW_SITE_ID;
const WEBFLOW_COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;

// --- Configuration ---
const WEBFLOW_API_VERSION = '1.0.0'; // As specified by Webflow API documentation

// --- Helper Function for API Requests ---
const createApiRequest = (url, method, headers = {}, data = null) => {
  return {
    url,
    method,
    headers: {
      'Accept': 'application/json',
      ...headers,
    },
    data,
  };
};

// --- Main Sync Logic ---
async function syncCircleMembers() {
  let circleMembers = [];
  let nextCursor = null;

  if (!CIRCLE_API_TOKEN || !WEBFLOW_API_TOKEN || !WEBFLOW_SITE_ID || !WEBFLOW_COLLECTION_ID) {
      console.error("Missing required environment variables. Please check your Vercel project settings.");
      return;
  }

  console.log('Starting Circle to Webflow member sync...');

  try {
    // --- 1. Fetch Data from Circle (Handle Pagination) ---
    do {
      console.log(`Fetching members from Circle... Cursor: ${nextCursor || 'initial'}`);
      const circleRequest = createApiRequest(
        `${CIRCLE_API_URL_MEMBERS}?limit=100${nextCursor ? `&cursor=${nextCursor}` : ''}`, // Adjust query params as per Circle API docs
        'GET',
        {
          'Authorization': `Bearer ${CIRCLE_API_TOKEN}`,
          // Add other Circle-specific authentication headers if required
          // Example: 'X-API-Key': CIRCLE_API_TOKEN
        }
      );

      const circleResponse = await axios(circleRequest);

      if (!circleResponse.data || !circleResponse.data.members) {
        console.warn('Circle API returned data without a "members" array or empty data.');
        break; // Exit if data structure is unexpected
      }

      circleMembers = circleMembers.concat(circleResponse.data.members);
      nextCursor = circleResponse.data.nextCursor; // Assuming Circle returns 'nextCursor' for pagination

      console.log(`Fetched ${circleResponse.data.members.length} members. Total fetched so far: ${circleMembers.length}. Next Cursor: ${nextCursor}`);

      // Basic rate limit prevention (adjust as needed based on Circle API limits)
      await new Promise(resolve => setTimeout(resolve, 100)); // Short delay between paginated requests

    } while (nextCursor);

    if (circleMembers.length === 0) {
      console.log("No members fetched from Circle or API returned no members.");
      return;
    }

    console.log(`Successfully fetched ${circleMembers.length} members from Circle.`);

    // --- 2. Process and Sync Each Member ---
    for (const circleMember of circleMembers) {
      // --- Extract Member Data ---
      // NOTE: The structure of circleMember.profile can vary greatly.
      // You WILL need to adjust these field names based on the actual data Circle sends.
      const circleUserId = circleMember.id; // Usually the primary ID from Circle
      const name = circleMember.name || circleMember.profile?.name || ''; // Try direct or nested
      const email = circleMember.email || circleMember.profile?.email || '';
      const bio = circleMember.profile?.bio || '';
      // Profile picture URL can be tricky. It might be nested differently.
      // Check the actual response from Circle. It might be an object with a 'url' property.
      const profilePictureUrl = circleMember.profile?.profilePictureUrl || circleMember.profile?.photoUrl || '';


      // Ensure essential data is present
      if (!circleUserId || !name || !email) {
        console.warn(`Skipping member due to missing essential data (ID, Name, or Email): `, circleMember);
        continue; // Skip this member if critical data is missing
      }

      const slug = String(circleUserId); // Ensure slug is a string

      // --- 3. Search Webflow CMS for Existing Member ---
      console.log(`Searching Webflow for member with Circle User ID: ${circleUserId}`);
      const searchWebflowRequest = createApiRequest(
        `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items?filter={"circleUserId":"${circleUserId}"}`, // IMPORTANT: 'circleUserId' must match your CMS field name exactly.
        'GET',
        {
          'Authorization': `Bearer ${WEBFLOW_API_TOKEN}`,
          'accept-version': WEBFLOW_API_VERSION,
        }
      );

      let searchResponse;
      try {
          searchResponse = await axios(searchWebflowRequest);
      } catch (searchError) {
          if (searchError.response && searchError.response.status === 404) {
              console.log(`Member with Circle User ID ${circleUserId} not found in Webflow.`);
              // Proceed to create
          } else {
              console.error(`Error searching Webflow for Circle User ID ${circleUserId}:`, searchError.response ? searchError.response.data : searchError.message);
              continue; // Skip to next member if there's an API error
          }
      }


      // --- 4. Create or Update Item in Webflow ---
      if (searchResponse && searchResponse.data && searchResponse.data.items && searchResponse.data.items.length > 0) {
        // Member Exists: Update
        const existingItemId = searchResponse.data.items[0].id;
        console.log(`Found existing Webflow item for ${name} (${circleUserId}). Updating...`);

        const updatePayload = {
          fields: {
            "name": name,
            "email": email,
            "bio": bio,
            // For images, Webflow often expects an object with a 'url' property.
            // If profilePictureUrl is empty, you might want to set it to null or an empty string field if Webflow allows.
            // Adjust based on your Webflow collection's image field setup.
            "profilePicture": profilePictureUrl ? { url: profilePictureUrl } : null,
            "circleUserId": circleUserId, // Keep this synced too
            "slug": slug
            // Add other fields as needed, ensuring they match your Webflow CMS fields exactly.
            // Example: "custom-field-name": "value"
          }
        };

        const updateWebflowRequest = createApiRequest(
          `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items/${existingItemId}`,
          'PUT', // Webflow API typically uses PUT for updates
          {
            'Authorization': `Bearer ${WEBFLOW_API_TOKEN}`,
            'Content-Type': 'application/json',
            'accept-version': WEBFLOW_API_VERSION,
          },
          updatePayload
        );

        try {
          await axios(updateWebflowRequest);
          console.log(`Successfully updated member: ${name} (${circleUserId}) in Webflow.`);
        } catch (updateError) {
          console.error(`Error updating member ${name} (${circleUserId}) in Webflow:`, updateError.response ? updateError.response.data : updateError.message);
        }

      } else {
        // Member Does Not Exist: Create
        console.log(`Member ${name} (${circleUserId}) not found in Webflow. Creating new item...`);

        const createPayload = {
          fields: {
            "name": name,
            "email": email,
            "bio": bio,
            "profilePicture": profilePictureUrl ? { url: profilePictureUrl } : null,
            "circleUserId": circleUserId, // Store the Circle User ID for future lookups
            "slug": slug
            // Add other fields as needed
          }
        };

        const createWebflowRequest = createApiRequest(
          `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items`,
          'POST',
          {
            'Authorization': `Bearer ${WEBFLOW_API_TOKEN}`,
            'Content-Type': 'application/json',
            'accept-version': WEBFLOW_API_VERSION,
          },
          createPayload
        );

        try {
          await axios(createWebflowRequest);
          console.log(`Successfully created member: ${name} (${circleUserId}) in Webflow.`);
        } catch (createError) {
          console.error(`Error creating member ${name} (${circleUserId}) in Webflow:`, createError.response ? createError.response.data : createError.message);
        }
      }

      // --- Rate Limiting / Delay ---
      // Be mindful of both Circle and Webflow API rate limits.
      // A small delay between processing members can prevent hitting limits.
      await new Promise(resolve => setTimeout(resolve, 200)); // Adjust delay as needed

    } // End of member loop

    console.log('Circle to Webflow member sync completed.');

  } catch (error) {
    console.error('An error occurred during the sync process:', error.message || error);
    if (error.response) {
        console.error('Error details:', error.response.data);
    }
  }
}

// --- Export for Vercel Scheduled Functions ---
// Vercel expects a default export.
// If you want this to be a *scheduled* function, your vercel.json would point to this file.
// For manual testing or a non-scheduled endpoint, you might export it differently or call it directly.

// For direct execution (e.g., in a test script) or if Vercel automatically triggers default exports:
module.exports = syncCircleMembers;

// If you were using this as an API endpoint for manual triggering, you'd use something like:
// export default async function handler(req, res) {
//   if (req.method === 'POST') { // Allow manual trigger via POST
//     await syncCircleMembers();
//     res.status(200).send('Sync initiated.');
//   } else {
//     res.status(405).send('Method not allowed');
//   }
// }