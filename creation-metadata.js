'use strict';

function registerCreatedItems(previousItems, submittedItems, userId, createdAt = new Date().toISOString().slice(0, 10)) {
  const previousById = new Map((previousItems || []).map(item => [item.id, item]));
  return submittedItems.map(item => {
    const previous = previousById.get(item.id);
    if (!previous) return { ...item, createdAt, createdByUserId: userId };
    return { ...item, createdAt: previous.createdAt, createdByUserId: previous.createdByUserId };
  });
}

module.exports = { registerCreatedItems };
