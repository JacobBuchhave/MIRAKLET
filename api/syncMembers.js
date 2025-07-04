// --- 2. Process and Sync Each Member ---
for (const circleMember of circleMembers) {
  // --- Extract Member Data ---
  const circleUserId = circleMember.id; // Usually the primary ID from Circle
  const name = circleMember.name || ''; // Circle Member Name
  const bio = circleMember.profile?.bio || ''; // Circle Member Bio
  const headline = circleMember.profile?.headline || ''; // Circle Member Headline
  const email = circleMember.email || ''; // Circle Member Email
  const website = circleMember.profile?.website || ''; // Circle Member Website
  const location = circleMember.profile?.location || ''; // Circle Member Location
  const signupDate = circleMember.createdAt || ''; // Circle Account Created Date
  const facebookUrl = circleMember.profile?.facebook || ''; // Circle Facebook URL
  const linkedInUrl = circleMember.profile?.linkedin || ''; // Circle LinkedIn URL
  const instagramUrl = circleMember.profile?.instagram || ''; // Circle Instagram URL

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
      "circleUserId": circleUserId, // Keep this synced too for future lookups
      "slug": slug // Optional: You may want a unique slug
    }
  };

  if (searchResponse && searchResponse.data && searchResponse.data.items && searchResponse.data.items.length > 0) {
    // Member Exists: Update
    const existingItemId = searchResponse.data.items[0].id;
    console.log(`Found existing Webflow item for ${name} (${circleUserId}). Updating...`);

    const updateWebflowRequest = createApiRequest(
      `https://api.webflow.com/collections/${WEBFLOW_COLLECTION_ID}/items/${existingItemId}`,
      'PUT', // Webflow API typically uses PUT for updates
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

}

console.log('Creating/updating Webflow item with payload:', JSON.stringify(webflowPayload, null, 2));
