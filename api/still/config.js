// Publishable keys are safe to expose client-side, but since this site has
// no build step to inject env vars into static HTML, the /still/book page
// fetches this small endpoint on load instead of a key being
// hardcoded/committed.
module.exports = async (req, res) => {
  res.status(200).json({
    stripe_publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || null,
  });
};
