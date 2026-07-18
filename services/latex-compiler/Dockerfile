FROM texlive/texlive:latest

# Create a stable symlink to the TeX Live bin dir (year/arch-agnostic)
RUN ln -sfn "$(ls -d /usr/local/texlive/[0-9]*/bin/*-linux | head -1)" \
            /usr/local/texlive/bin-active

ENV PATH="/usr/local/texlive/bin-active:${PATH}"

# Install Node.js + altacv (not in TeX Live repo, sourced from GitHub)
RUN apt-get update && apt-get install -y curl nodejs npm && \
    mkdir -p /usr/local/texlive/texmf-local/tex/latex/altacv && \
    curl -fsSL https://raw.githubusercontent.com/liantze/AltaCV/main/altacv.cls \
         -o /usr/local/texlive/texmf-local/tex/latex/altacv/altacv.cls && \
    mktexlsr && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

EXPOSE 3002

# Run as non-root for security
RUN useradd -m compiler
USER compiler

CMD ["node", "server.js"]
