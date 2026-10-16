(() => {
  const $ = (id) => document.getElementById(id);
  const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const favoritesKey = 'film-archive-favorites-v1';
  const searchCacheKey = 'film-archive-search-cache-v1';
  const randomCacheKey = 'film-archive-random-cache-v1';
  let favorites = readJson(favoritesKey, []);
  if (!Array.isArray(favorites)) favorites = [];
  let lastSearchParams = null;
  let lastSearchAt = 0;
  let searchBusy = false;
  let searchRequestVersion = 0;
  let randomBusy = false;
  let randomLastAt = 0;
  let visibleSearchFilms = [];
  let visibleRandomFilm = null;

  const genres = {
    Q130232: 'Драма', Q157443: 'Комедия', Q188473: 'Боевик', Q24925: 'Научная фантастика',
    Q200092: 'Ужасы', Q2484376: 'Триллер', Q202866: 'Анимация', Q93204: 'Документальный'
  };
  const countries = {
    Q30: 'США', Q142: 'Франция', Q17: 'Япония', Q15180: 'СССР', Q145: 'Великобритания', Q183: 'Германия'
  };

  const currentYear = new Date().getFullYear();
  $('year-from').max = String(currentYear);
  $('year-to').max = String(currentYear);
  $('year-to').value = String(currentYear);

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* The page still works if browser storage is unavailable. */ }
  }

  function node(tag, text, parent) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (parent) parent.append(element);
    return element;
  }

  function setState(id, message, state) {
    const status = $(id);
    status.textContent = message;
    status.dataset.state = state;
    const section = status.closest('section');
    if (section) section.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  }

  function showStale(id, timestamp, message) {
    const note = $(id);
    note.hidden = !message;
    note.textContent = message || '';
  }

  function sparqlLiteral(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
  }

  function posterUrl(filename) {
    if (typeof filename !== 'string' || !filename.trim()) return '';
    return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(filename.trim()) + '?width=360';
  }

  function appendPoster(parent, source, title, compact, sourceIsUrl = false) {
    const imageUrl = sourceIsUrl
      ? (typeof source === 'string' && /^https:\/\/upload\.wikimedia\.org\//.test(source) ? source : '')
      : posterUrl(source);
    const fallback = compact ? 'НЕТ ОБЛОЖКИ' : 'ПОСТЕР НЕ НАЙДЕН';
    if (!imageUrl) {
      const placeholder = node('span', fallback, parent);
      placeholder.setAttribute('aria-label', fallback);
      return;
    }
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = 'Постер фильма «' + title + '»';
    image.loading = 'lazy';
    const placeholder = node('span', fallback);
    placeholder.hidden = true;
    const showFallback = () => {
      image.hidden = true;
      placeholder.hidden = false;
    };
    image.addEventListener('error', showFallback, { once: true });
    parent.append(image, placeholder);
    if (image.complete && image.naturalWidth === 0) showFallback();
  }

  function filmIsFavorite(id) {
    return favorites.some((film) => film.id === id);
  }

  function makeHeartButton(film, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.filmId = film.id;
    button.textContent = filmIsFavorite(film.id) ? '♥' : '♡';
    button.setAttribute('aria-pressed', filmIsFavorite(film.id) ? 'true' : 'false');
    button.setAttribute('aria-label', (filmIsFavorite(film.id) ? 'Убрать из избранного: ' : 'Добавить в избранное: ') + film.title);
    button.title = label || 'В избранное';
    button.addEventListener('click', () => toggleFavorite(film));
    return button;
  }

  function filmLink(film) {
    if (typeof film.articleUrl === 'string' && /^https?:\/\/(ru|en)\.wikipedia\.org\/wiki\//.test(film.articleUrl)) return film.articleUrl;
    if (/^Q\d+$/.test(film.id)) return 'https://www.wikidata.org/wiki/' + film.id;
    return '';
  }

  function renderSearchFilms(films) {
    visibleSearchFilms = films;
    const result = $('search-results');
    result.replaceChildren();
    films.forEach((film) => {
      const article = document.createElement('article');
      const poster = document.createElement('div');
      appendPoster(poster, film.poster, film.title, false);
      const details = document.createElement('div');
      node('h3', film.title, details);
      const release = film.releaseDate ? dateFormatter.format(new Date(film.releaseDate)) : 'Дата не указана';
      const notes = [genres[film.genre] || 'Жанр из фильтра', release];
      if (film.country) notes.push(countries[film.country] || 'Страна не указана');
      node('p', notes.join(' · '), details);
      const href = filmLink(film);
      if (href) {
        const link = node('a', 'Открыть карточку фильма', details);
        link.href = href;
        link.target = '_blank';
        link.rel = 'noreferrer';
      }
      details.append(makeHeartButton(film, 'В избранное'));
      article.append(poster, details);
      result.append(article);
    });
  }

  function renderRandomFilm(film, extract, thumbnail) {
    visibleRandomFilm = film;
    const target = $('random-result');
    target.replaceChildren();
    if (!film) return;
    const article = document.createElement('article');
    const poster = document.createElement('div');
    if (thumbnail) {
      appendPoster(poster, thumbnail, film.title, false, true);
    } else {
      appendPoster(poster, film.poster, film.title, false);
    }
    const details = document.createElement('div');
    details.id = 'random-detail';
    node('h3', film.title, details);
    node('p', 'Дата выхода: ' + (film.releaseDate ? dateFormatter.format(new Date(film.releaseDate)) : 'не указана'), details);
    if (film.description) node('p', film.description, details);
    else if (extract) node('p', extract, details);
    else node('p', 'Описание пока не добавлено в открытый каталог.', details);
    const href = filmLink(film);
    if (href) {
      const link = node('a', 'Открыть материал в Wikipedia / Wikidata', details);
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer';
    }
    details.append(makeHeartButton(film, 'В избранное'));
    article.append(poster, details);
    target.append(article);
  }

  function refreshHeartButtons() {
    document.querySelectorAll('button[data-film-id]').forEach((button) => {
      const active = filmIsFavorite(button.dataset.filmId);
      button.textContent = active ? '♥' : '♡';
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      const title = button.getAttribute('aria-label').replace(/^Добавить в избранное: |^Убрать из избранного: /, '');
      button.setAttribute('aria-label', (active ? 'Убрать из избранного: ' : 'Добавить в избранное: ') + title);
    });
  }

  function toggleFavorite(film) {
    if (filmIsFavorite(film.id)) favorites = favorites.filter((saved) => saved.id !== film.id);
    else favorites.unshift(film);
    writeJson(favoritesKey, favorites);
    renderFavorites();
    refreshHeartButtons();
  }

  function renderFavorites() {
    const list = $('favorites-list');
    list.replaceChildren();
    $('favorite-count').textContent = String(favorites.length);
    $('nav-favorite-count').textContent = String(favorites.length);
    $('favorites-empty').hidden = favorites.length > 0;
    favorites.forEach((film) => {
      const item = document.createElement('li');
      const poster = document.createElement('div');
      appendPoster(poster, film.poster, film.title, true);
      const info = document.createElement('div');
      node('strong', film.title || 'Без названия', info);
      const date = film.releaseDate ? dateFormatter.format(new Date(film.releaseDate)) : 'Дата не указана';
      node('span', date, info);
      const href = filmLink(film);
      if (href) {
        const link = node('a', 'Карточка', info);
        link.href = href;
        link.target = '_blank';
        link.rel = 'noreferrer';
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '♥';
      remove.setAttribute('aria-label', 'Убрать из избранного: ' + (film.title || 'фильм'));
      remove.title = 'Убрать с полки';
      remove.addEventListener('click', () => toggleFavorite(film));
      item.append(poster, info, remove);
      list.append(item);
    });
  }

  function normalizeBinding(binding, genre, country) {
    const uri = binding && binding.film && binding.film.value;
    const title = binding && binding.filmLabel && binding.filmLabel.value;
    const date = binding && binding.releaseDate && binding.releaseDate.value;
    if (typeof uri !== 'string' || !/^https?:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(uri)) return null;
    if (typeof title !== 'string' || !title.trim()) return null;
    if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) return null;
    const articleUri = binding.article && binding.article.value;
    const poster = binding.poster && binding.poster.value;
    return {
      id: uri.split('/').pop(),
      title: title.trim(),
      releaseDate: date,
      poster: typeof poster === 'string' ? poster : '',
      genre: genre || '',
      country: country || '',
      articleUrl: typeof articleUri === 'string' && /^https?:\/\/(ru|en)\.wikipedia\.org\/wiki\//.test(articleUri) ? articleUri : ''
    };
  }

  function makeSearchQuery(params) {
    const titleFilter = params.title
      ? 'FILTER(CONTAINS(LCASE(STR(?filmLabel)), LCASE("' + sparqlLiteral(params.title) + '")))'
      : '';
    const countryFilter = params.country ? '?film wdt:P495 wd:' + params.country + '.' : '';
    return `SELECT DISTINCT ?film ?filmLabel ?releaseDate ?poster ?article WHERE {
      ?film wdt:P31/wdt:P279* wd:Q11424;
            wdt:P136 wd:${params.genre};
            wdt:P577 ?releaseDate.
      FILTER(YEAR(?releaseDate) >= ${params.yearFrom} && YEAR(?releaseDate) <= ${params.yearTo})
      ${countryFilter}
      ${titleFilter}
      OPTIONAL { ?film wdt:P18 ?poster. }
      OPTIONAL { ?article schema:about ?film; schema:isPartOf <https://en.wikipedia.org/>. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "ru,en". }
    } LIMIT 12`;
  }

  function paramsKey(params) { return JSON.stringify(params); }

  function setSearchControlsDisabled(disabled) {
    ['title-query', 'genre-filter', 'country-filter', 'year-from', 'year-to', 'search-button', 'search-retry']
      .forEach((id) => { $(id).disabled = disabled; });
  }

  function currentSearchKey() {
    return paramsKey({
      title: $('title-query').value.trim(),
      genre: $('genre-filter').value,
      country: $('country-filter').value,
      yearFrom: Number($('year-from').value),
      yearTo: Number($('year-to').value)
    });
  }

  function handleSearchParameterChange() {
    if (searchBusy || !lastSearchParams || currentSearchKey() === paramsKey(lastSearchParams)) return;
    lastSearchParams = null;
    renderSearchFilms([]);
    showStale('search-stale', null, '');
    setState('search-feedback', 'Параметры изменились. Нажми «Найти фильмы», чтобы получить новую выдачу.', 'idle');
  }

  async function findMovies(params) {
    if (searchBusy || !params) return;
    const now = Date.now();
    if (now - lastSearchAt < 900) {
      setState('search-feedback', 'Подожди немного перед следующим поиском.', 'loading');
      return;
    }
    lastSearchAt = now;
    lastSearchParams = params;
    searchBusy = true;
    const requestVersion = ++searchRequestVersion;
    const requestKey = paramsKey(params);
    setSearchControlsDisabled(true);
    const cache = readJson(searchCacheKey, null);
    if (cache && paramsKey(cache.params) === paramsKey(params) && Array.isArray(cache.films) && cache.films.length) {
      renderSearchFilms(cache.films);
      showStale('search-stale', cache.updatedAt, 'Пока загружаем, показан сохранённый результат.');
    } else {
      $('search-results').replaceChildren();
      renderSearchFilms([]);
      showStale('search-stale', null, '');
    }
    setState('search-feedback', 'Ищем в открытом каталоге…', 'loading');
    try {
      const sparql = makeSearchQuery(params);
      const response = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json', {
        headers: { Accept: 'application/sparql-results+json' }
      });
      if (!response.ok) throw new Error('Каталог ответил с кодом ' + response.status + '.');
      const data = await response.json();
      if (!data || !data.results || !Array.isArray(data.results.bindings)) throw new Error('Каталог вернул неожиданный формат данных.');
      if (requestVersion !== searchRequestVersion || requestKey !== paramsKey(lastSearchParams)) return;
      const films = data.results.bindings.map((binding) => normalizeBinding(binding, params.genre, params.country));
      if (films.some((film) => !film)) throw new Error('В ответе каталога есть запись без корректного названия, ID или даты.');
      const updatedAt = new Date().toISOString();
      renderSearchFilms(films);
      showStale('search-stale', null, '');
      writeJson(searchCacheKey, { params, films, updatedAt });
      setState('search-feedback', films.length ? 'В архиве найдено ' + films.length + (films.length === 1 ? ' фильм.' : films.length < 5 ? ' фильма.' : ' фильмов.') : 'По этим параметрам фильмов не найдено.', films.length ? 'success' : 'empty');
    } catch (error) {
      if (requestVersion !== searchRequestVersion || requestKey !== paramsKey(lastSearchParams)) return;
      const previous = readJson(searchCacheKey, null);
      if (previous && paramsKey(previous.params) === paramsKey(params) && Array.isArray(previous.films) && previous.films.length) {
        renderSearchFilms(previous.films);
        showStale('search-stale', previous.updatedAt, 'Не удалось обновить архив. Показаны устаревшие результаты.');
      } else {
        renderSearchFilms([]);
        showStale('search-stale', null, '');
      }
      setState('search-feedback', 'Ошибка поиска: ' + (error.message || 'проверь соединение.') + ' Нажми «Повторить последний поиск».', 'error');
    } finally {
      if (requestVersion === searchRequestVersion) {
        searchBusy = false;
        setSearchControlsDisabled(false);
      }
    }
  }

  function makeRecentQuery(startDate, endDate) {
    return `SELECT DISTINCT ?film ?filmLabel ?releaseDate ?poster ?articleTitle WHERE {
      ?film wdt:P31 wd:Q11424; wdt:P577 ?releaseDate.
      FILTER(?releaseDate >= "${startDate}T00:00:00Z"^^xsd:dateTime && ?releaseDate <= "${endDate}T23:59:59Z"^^xsd:dateTime)
      OPTIONAL { ?film wdt:P18 ?poster. }
      ?article schema:about ?film; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?articleTitle.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ru". }
    } LIMIT 300`;
  }

  function normalizeRecentBinding(binding) {
    const normalized = normalizeBinding(binding, '', '');
    if (!normalized) return null;
    const title = binding.articleTitle && typeof binding.articleTitle.value === 'string' ? binding.articleTitle.value : '';
    if (!title) return null;
    normalized.articleTitle = title;
    return normalized;
  }

  async function fetchWikipediaSummary(articleTitle) {
    if (!articleTitle) return null;
    const page = encodeURIComponent(articleTitle.replace(/ /g, '_'));
    const response = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + page, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Wikipedia REST API ответил с кодом ' + response.status + '.');
    const data = await response.json();
    if (!data || typeof data.extract !== 'string') throw new Error('Wikipedia вернула карточку без описания.');
    const thumbnail = data.thumbnail && typeof data.thumbnail.source === 'string' && /^https:\/\/upload\.wikimedia\.org\//.test(data.thumbnail.source)
      ? data.thumbnail.source : '';
    return { extract: data.extract, thumbnail };
  }

  async function pickRecentMovie() {
    if (randomBusy) return;
    if (Date.now() - randomLastAt < 900) {
      setState('random-feedback', 'Подожди немного перед следующей находкой.', 'loading');
      return;
    }
    randomLastAt = Date.now();
    randomBusy = true;
    $('random-button').disabled = true;
    const cache = readJson(randomCacheKey, null);
    if (cache && cache.film) {
      renderRandomFilm(cache.film, cache.extract, cache.thumbnail);
      showStale('random-stale', cache.updatedAt, 'Пока проверяем свежие релизы, показана последняя находка.');
    } else {
      $('random-result').replaceChildren();
      renderRandomFilm(null);
      showStale('random-stale', null, '');
    }
    setState('random-feedback', 'Проверяем даты релизов за последние 365 дней…', 'loading');
    try {
      const today = new Date();
      const start = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
      const startDate = start.toISOString().slice(0, 10);
      const endDate = today.toISOString().slice(0, 10);
      const sparql = makeRecentQuery(startDate, endDate);
      const endpoint = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql) + '&format=json';
      const wikidataResponse = await fetch(endpoint, { headers: { Accept: 'application/sparql-results+json' } });
      if (!wikidataResponse.ok) throw new Error('Wikidata ответил с кодом ' + wikidataResponse.status + '.');
      const data = await wikidataResponse.json();
      if (!data || !data.results || !Array.isArray(data.results.bindings)) throw new Error('Каталог вернул неожиданный формат данных.');
      const candidates = data.results.bindings.map(normalizeRecentBinding);
      if (candidates.some((film) => !film)) throw new Error('В ответе каталога есть запись с неполными данными о фильме.');
      const uniqueCandidates = [...new Map(candidates.map((film) => [film.id, film])).values()];
      if (!uniqueCandidates.length) {
        renderRandomFilm(null);
        showStale('random-stale', null, '');
        setState('random-feedback', 'В открытом каталоге пока нет фильмов с датой релиза за последние 365 дней.', 'empty');
        return;
      }
      const film = uniqueCandidates[Math.floor(Math.random() * uniqueCandidates.length)];
      setState('random-feedback', 'Есть находка: фильм вышел за последние 365 дней.', 'loading');
      let summary = null;
      let summaryIssue = '';
      try {
        summary = await fetchWikipediaSummary(film.articleTitle);
      } catch (error) {
        summaryIssue = error.message || 'описание недоступно';
      }
      const extract = summary ? summary.extract : '';
      const thumbnail = summary ? summary.thumbnail : '';
      renderRandomFilm(film, extract, thumbnail);
      const updatedAt = new Date().toISOString();
      showStale('random-stale', null, '');
      writeJson(randomCacheKey, { film, extract, thumbnail, updatedAt });
      setState('random-feedback', summaryIssue
        ? 'Фильм найден. Краткое описание временно недоступно (' + summaryIssue + ').'
        : 'Случайный фильм выбран из релизов последних 365 дней.', 'success');
    } catch (error) {
      const previous = readJson(randomCacheKey, null);
      if (previous && previous.film) {
        renderRandomFilm(previous.film, previous.extract, previous.thumbnail);
        showStale('random-stale', previous.updatedAt, 'Не удалось обновить случайную находку. Показан устаревший результат.');
      } else {
        renderRandomFilm(null);
        showStale('random-stale', null, '');
      }
      setState('random-feedback', 'Ошибка загрузки: ' + (error.message || 'проверь соединение.') + ' Нажми «Найти фильм», чтобы повторить.', 'error');
    } finally {
      randomBusy = false;
      $('random-button').disabled = false;
    }
  }

  function readSearchParams() {
    const title = $('title-query').value.trim();
    const genre = $('genre-filter').value;
    const country = $('country-filter').value;
    const yearFrom = Number($('year-from').value);
    const yearTo = Number($('year-to').value);
    const error = $('search-error');
    if (!Number.isInteger(yearFrom) || !Number.isInteger(yearTo) || yearFrom < 1888 || yearTo > currentYear || yearFrom > yearTo) {
      error.textContent = 'Укажи целые годы от 1888 до ' + currentYear + ' и проверь, что начальный год не позже конечного.';
      error.hidden = false;
      $('year-from').focus();
      return null;
    }
    error.hidden = true;
    error.textContent = '';
    return { title, genre, country, yearFrom, yearTo };
  }

  $('search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const params = readSearchParams();
    if (params) findMovies(params);
  });
  ['title-query', 'genre-filter', 'country-filter', 'year-from', 'year-to'].forEach((id) => {
    $(id).addEventListener('input', handleSearchParameterChange);
    $(id).addEventListener('change', handleSearchParameterChange);
  });
  $('search-retry').addEventListener('click', () => {
    if (lastSearchParams) findMovies(lastSearchParams);
    else $('search-form').requestSubmit();
  });
  $('random-button').addEventListener('click', pickRecentMovie);
  renderFavorites();
})();


