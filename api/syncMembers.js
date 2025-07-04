// --- Imports ---
const axios = require('axios'); // Use require for Node.js environments in Vercel

// --- Environment Variables ---
// IMPORTANT: These will be set in your Vercel project settings.
const CIRCLE_API_TOKEN = process.env.CIRCLE_API_TOKEN;
const CIRCLE_API_URL_MEMBERS = 'https://api.circle.so/v1/members'; // Adjust based on Circle's API documentation
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

  // Check for required environment variables
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
        `${CIRCLE_API_URL_MEMBERS}?limit=100${nextCursor ? `&cursor=${nextCursor}` : ''}`, 
        'GET',
        {
          'Authorization': `Bearer ${CIRCLE_API_TOKEN}`,
        }
      );

      const circleResponse = await axios(circleRequest);

      // Check for valid data
      if (!circleResponse.data || !circleResponse.data.members) {
        console.warn('Circle API returned data without a "members" array or empty data.');
        break; // Exit if data structure is unexpected
      }

      circleMembers = circleMembers.concat(circleResponse.data.members);
      nextCursor = circleResponse.data.nextCursor; // Assuming Circle returns 'nextCursor'

      console.log(`Fetched ${circleResponse.data.members.length} members. Total fetched so far: ${circleMembers.length}. Next Cursor: ${nextCursor}`);

      // Rate limit prevention
      await new Promise(resolve => setTimeout(resolve, 100)); // Short delay between paginated requests

    } while (nextCursor);

    if (circleMembers.length === 0) {
      console.log("No members fetched from Circle or API returned no members.");
      return;
    }

    console.log(`Successfully fetched ${circleMembers.length} members from Circle.`);

    // --- 2. Process and Sync Each Member ---
    for (const circleMember of circleMembers) {
      // Extract Member Data
      const circleUserId = circleMember.id; // Primary ID from Circle
      const name = circleMember.name || ''; // Circle Member Name
      const bio = circleMember.profile?.bio || ''; // Circle Member Bio
      const headline = circleMember.profile?.headline || ''; // Circle Member Headline
      const email = circleMember.email || ''; // Circle Member Email
      const website = circleMember.profile?.website || ''; // Circle Member Website
      const location = circleMember.profile?.location || ''; // Circle Member Location
      const signupDate = circleMember.createdAt || ''; // Account Created Date
      const facebookUrl = circleMember.profile?.facebook || ''; // Facebook URL
      const linkedInUrl = circleMember.profile?.linkedin || ''; // LinkedIn URL
      const instagramUrl = circleMember.profile?.instagram || ''; // Instagram URL

      // Ensure essential data is present
      if (!circleUserId || !name || !email) {
        console.warn(`Skipping member due to missing essential data (ID, Name, or Email): `, circleMember);
        continue; // Skip this member if critical data is missing
      }

      const slug = String(circleUserId); // Ensure slug is present and valid

      // --- 3. Search Webflow CMS for Existing Member ---
      console.log(`Searching Webflow for member with Circle User ID: ${circleUserId}`);
      const searchWebflowRequest = createApiRequest(
        `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items?filter={"circleUserId":"${circleUserId}"}`,
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
      const webflowPayload = {
        fields: {
          "name": name, // Webflow Name field
          "bio": bio, // Webflow Description field
          "headline": headline, // Assuming 'Titel' refers to this
          "email": email, // Webflow Mail field
          "website": website, // Webflow Website field
          "location": location, // Webflow Location field
          "signupDate": signupDate, // Webflow Signup date field
          "facebook": facebookUrl, // Webflow Facebook URL field
          "linkedin": linkedInUrl, // Webflow LinkedIn URL field
          "instagram": instagramUrl, // Webflow Instagram URL field
          "circleUserId": circleUserId, // Keep synced for future lookups
          "slug": slug // Optional: You may want a unique slug
        }
      };

      if (searchResponse && searchResponse.data && searchResponse.data.items && searchResponse.data.items.length > 0) {
        // Member Exists: Update
        const existingItemId = searchResponse.data.items[0].id;
        console.log(`Found existing Webflow item for ${name} (${circleUserId}). Updating...`);

        const updateWebflowRequest = createApiRequest(
          `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items/${existingItemId}`,
          'PUT',
          {
            'Authorization': `Bearer ${WEBFLOW_API_TOKEN}`,
            'Content-Type': 'application/json',
            'accept-version': WEBFLOW_API_VERSION,
          },
          webflowPayload
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

        const createWebflowRequest = createApiRequest(
          `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items`,
          'POST',
          {
            'Authorization': `Bearer ${WEBFLOW_API_TOKEN}`,
            'Content-Type': 'application/json',
            'accept-version': WEBFLOW_API_VERSION,
          },
          webflowPayload
        );

        try {
          await axios(createWebflowRequest);
          console.log(`Successfully created member: ${name} (${circleUserId}) in Webflow.`);
        } catch (createError) {
          console.error(`Error creating member ${name} (${circleUserId}) in Webflow:`, createError.response ? createError.response.data : createError.message);
        }
      }

      // --- Rate Limiting / Delay ---
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
module.exports = syncCircleMembers; // Export the main function for Vercel