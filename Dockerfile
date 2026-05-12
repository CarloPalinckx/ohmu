FROM ubuntu:24.04

ENV TERM=xterm-256color \
    COLORTERM=truecolor \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=Europe/Amsterdam

RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install pi coding agent globally (provides the SDK used by the orchestrator)
RUN npm install -g @earendil-works/pi-coding-agent

RUN useradd -m -s /bin/bash ohmu

# Install agent dependencies at /opt so they are not shadowed
# by the runtime volume mount of /home/ohmu.
COPY --chown=ohmu:ohmu package.json /opt/agent/package.json
RUN npm install --prefix /opt/agent

# NODE_PATH lets tsx resolve @earendil-works/pi-coding-agent from the global install.
# The local /opt install supplies tsx itself plus any other direct deps.
ENV NODE_PATH=/usr/lib/node_modules

# Copy the rest of the ohmu home at build time; at runtime the volume mount
# overlays /home/ohmu with the live source, including src/ and skills/.
COPY --chown=ohmu:ohmu . /home/ohmu/

# Pre-trust GitHub so git operations don't prompt
RUN mkdir -p /home/ohmu/.ssh && chmod 700 /home/ohmu/.ssh \
    && ssh-keyscan github.com >> /home/ohmu/.ssh/known_hosts 2>/dev/null \
    && chown -R ohmu:ohmu /home/ohmu/.ssh

USER ohmu
WORKDIR /home/ohmu

CMD ["/opt/agent/node_modules/.bin/tsx", "/home/ohmu/src/index.ts"]
