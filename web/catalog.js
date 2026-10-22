const renderTrace = (listId, header) => {
  const list = document.getElementById(listId);
  list.replaceChildren();
  const steps = header?.split(" -> ").filter(Boolean) ?? [];
  if (steps.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Traza no disponible";
    list.appendChild(item);
    return;
  }

  for (const step of steps) {
    const item = document.createElement("li");
    item.textContent = step;
    list.appendChild(item);
  }
};

const loadMovies = async () => {
  const status = document.getElementById("status");
  try {
    const response = await fetch("/api/movies/top");
    renderTrace("movies-trace", response.headers.get("X-Request-Trace"));
    if (!response.ok) throw new Error("La API del catálogo de películas no está disponible.");
    const movies = await response.json();
    status.textContent = "";
    const list = document.getElementById("movies");
    list.replaceChildren();
    for (const movie of movies) {
      const card = document.createElement("div");
      card.className = "movie-card";
      card.innerHTML = `
        <div class="movie-header">
          <span class="movie-code">${movie.code || movie.sku}</span>
          <span class="movie-rating">★ ${Number(movie.rating || movie.price).toFixed(1)}/10</span>
        </div>
        <h3 class="movie-title">${movie.title || movie.name}</h3>
        <p class="movie-meta"><strong>Director:</strong> ${movie.director || "N/A"}</p>
        <p class="movie-meta"><strong>Género:</strong> ${movie.genre || movie.description || "N/A"}</p>
        <p class="movie-meta"><strong>Año:</strong> ${movie.release_year || "N/A"}</p>
      `;
      list.appendChild(card);
    }
  } catch (error) {
    status.textContent = error.message;
  }
};

const loadReviews = async () => {
  const status = document.getElementById("reviews-status");
  try {
    const response = await fetch("/api/movies/MOV-001/reviews");
    renderTrace("reviews-trace", response.headers.get("X-Request-Trace"));
    if (!response.ok) throw new Error("La API de reseñas no está disponible.");
    const { reviews } = await response.json();
    status.textContent = reviews.length === 0 ? "Aún no hay críticas registradas." : "";
    const list = document.getElementById("reviews");
    list.replaceChildren();
    for (const review of reviews) {
      const item = document.createElement("li");
      item.className = "review-item";
      item.innerHTML = `
        <div class="review-author">
          <strong>${review.reviewer}</strong>
          <span class="review-stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)} (${review.rating}/5)</span>
        </div>
        <p class="review-text">"${review.comment}"</p>
      `;
      list.appendChild(item);
    }
  } catch (error) {
    status.textContent = error.message;
  }
};

const queryEndpoint = async (path, method = "GET") => {
  const status = document.getElementById("api-result-status");
  const result = document.getElementById("api-result");
  status.textContent = "Procesando petición en el cluster...";
  result.textContent = "";
  try {
    const response = await fetch(`/api${path}`, { method });
    renderTrace("api-trace", response.headers.get("X-Request-Trace"));
    const payload = await response.json();
    result.textContent = JSON.stringify(payload, null, 2);
    status.textContent = `${method} ${path} — HTTP ${response.status}`;
  } catch (error) {
    renderTrace("api-trace", null);
    status.textContent = error.message;
  }
};

document.getElementById("query-api").addEventListener("click", () => {
  void queryEndpoint(document.getElementById("api-endpoint").value);
});

document.getElementById("clear-cache").addEventListener("click", () => {
  void queryEndpoint("/cache/clear", "POST").then(() => {
    void loadMovies();
  });
});

void Promise.all([loadMovies(), loadReviews()]);
