function formatAnnualRevenue(annualRevenue) {
  if (!annualRevenue) {
    return "Not provided";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(annualRevenue);
}

module.exports = { formatAnnualRevenue };
