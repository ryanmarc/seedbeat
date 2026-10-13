interface TitleProps {
  generatorVersion: number;
}

export function Title({ generatorVersion }: TitleProps) {
  return (
    <main
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        textAlign: 'center',
      }}
    >
      <div>
        <h1 style={{ letterSpacing: '0.08em', margin: 0 }}>SEEDBEAT</h1>
        <p style={{ color: '#a39cbd', margin: '0.5rem 0 0' }}>
          Type a seed and get a song. Generator v{generatorVersion}.
        </p>
      </div>
    </main>
  );
}
